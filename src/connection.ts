import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB
const CACHE_TTL_MS = 5000 // 5 seconds LRU cache

export interface SshRunResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  error?: string
}

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  broken: boolean
  hidden: boolean
}

export interface FsListing {
  path: string
  entries: FsEntry[]
  truncated: boolean
}

export interface FsReadResult {
  ok: boolean
  kind?: 'text' | 'binary'
  content?: string
  head?: string
  size?: number
  truncated?: boolean
  error?: string
}

function getSocketDir(): string {
  const dir = join(homedir(), '.dsh', 'dsh-ssh', 'sockets')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function shellQuote(p: string): string {
  if (!p) return "''"
  return "'" + String(p).replace(/'/g, "'\\''") + "'"
}

function translateSshError(text: string): string {
  const t = String(text || '')
  if (/permission denied \(publickey/i.test(t)) {
    return 'SSH 公钥认证失败：请确认私钥配置或目标主机的 ~/.ssh/authorized_keys 中已添加对应公钥。'
  }
  if (/connection refused/i.test(t)) {
    return 'SSH 连接被拒绝：请确认目标主机已开机、sshd 服务已启动且端口开放。'
  }
  if (/connection timed out|timed out|operation timed out/i.test(t)) {
    return 'SSH 连接超时：请检查网络连通性、防火墙规则或跳板机 (ProxyJump) 配置。'
  }
  if (/could not resolve hostname/i.test(t)) {
    return '无法解析主机名：请检查 ~/.ssh/config 中的 HostName 拼写。'
  }
  return t.trim().slice(0, 500)
}

/**
 * Execute a command on remote host via OpenSSH CLI with ControlMaster socket multiplexing.
 */
export async function runSsh(
  host: string,
  command: string,
  stdinData?: string | Buffer,
  timeoutMs = 30000
): Promise<SshRunResult> {
  const socketDir = getSocketDir()
  const socketPath = join(socketDir, '%r@%h:%p')

  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ControlMaster=auto',
    '-o', `ControlPath=${socketPath}`,
    '-o', 'ControlPersist=10m',
    host,
    command
  ]

  return new Promise((resolve) => {
    let stdoutText = ''
    let stderrText = ''
    let resolved = false

    const child = spawn('ssh', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { child.kill('SIGKILL') } catch {}
        resolve({
          ok: false,
          exitCode: -1,
          stdout: stdoutText,
          stderr: stderrText,
          error: `SSH 命令执行超时 (${timeoutMs / 1000}s)`
        })
      }
    }, timeoutMs)

    if (stdinData !== undefined && child.stdin) {
      child.stdin.write(stdinData)
      child.stdin.end()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutText.length < MAX_BYTES) {
        stdoutText += chunk.toString('utf8')
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrText.length < 512 * 1024) {
        stderrText += chunk.toString('utf8')
      }
    })

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve({
          ok: false,
          exitCode: -1,
          stdout: stdoutText,
          stderr: stderrText,
          error: 'SSH 进程启动失败: ' + err.message
        })
      }
    })

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        const exitCode = code ?? 0
        const ok = exitCode === 0
        const errHint = !ok ? (translateSshError(stderrText) || `SSH 退出码: ${exitCode}`) : undefined
        resolve({
          ok,
          exitCode,
          stdout: stdoutText,
          stderr: stderrText,
          error: errHint
        })
      }
    })
  })
}

// ---------------------------------------------------------------------------
// In-Memory Cache (LRU + TTL)
// ---------------------------------------------------------------------------

interface CacheItem<T> {
  data: T
  timestamp: number
}

const listCache = new Map<string, CacheItem<FsListing>>()
const readCache = new Map<string, CacheItem<FsReadResult>>()

export function invalidateCache(host?: string, remotePath?: string) {
  if (!host) {
    listCache.clear()
    readCache.clear()
    return
  }
  const prefix = remotePath ? `${host}|${remotePath}` : `${host}|`
  for (const k of listCache.keys()) {
    if (k.startsWith(prefix)) listCache.delete(k)
  }
  for (const k of readCache.keys()) {
    if (k.startsWith(prefix)) readCache.delete(k)
  }
}

// ---------------------------------------------------------------------------
// High-Level Remote Filesystem Operations
// ---------------------------------------------------------------------------

/**
 * List files in a remote directory. Formatted for dsh-better-sidebar.
 */
export async function remoteListDir(
  host: string,
  remotePath: string,
  localDisplayPath: string
): Promise<{ ok: boolean; data?: FsListing; error?: string }> {
  const cacheKey = `${host}|${remotePath}`
  const cached = listCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Return cached listing with updated display path
    return {
      ok: true,
      data: {
        path: localDisplayPath,
        entries: cached.data.entries.map((e) => ({
          ...e,
          path: localDisplayPath.endsWith('/') || localDisplayPath.endsWith('\\')
            ? `${localDisplayPath}${e.name}`
            : `${localDisplayPath}/${e.name}`
        })),
        truncated: cached.data.truncated
      }
    }
  }

  // Fast find printf command with fallback
  const script = `( cd ${shellQuote(remotePath)} 2>/dev/null || { echo '__DSH_ERR_CD__'; exit 1; }; ` +
    `find . -maxdepth 1 -mindepth 1 -printf '%Y\\t%f\\t%s\\n' 2>/dev/null || ` +
    `ls -1ap 2>/dev/null )`

  const r = await runSsh(host, script)
  if (!r.ok) {
    if (r.stdout.includes('__DSH_ERR_CD__')) {
      return { ok: false, error: `远程目录不存在或无访问权限: ${remotePath}` }
    }
    return { ok: false, error: r.error || r.stderr || '读取远程目录失败' }
  }

  const lines = r.stdout.split(/\r?\n/).filter(Boolean)
  const entries: FsEntry[] = []

  for (const line of lines) {
    if (line.includes('\t')) {
      // Formatted by find -printf '%Y\t%f\t%s'
      const [type, name, _size] = line.split('\t')
      if (!name || name === '.' || name === '..') continue
      const isDir = type === 'd'
      const isSymlink = type === 'l'
      entries.push({
        name,
        path: localDisplayPath.endsWith('/') || localDisplayPath.endsWith('\\')
          ? `${localDisplayPath}${name}`
          : `${localDisplayPath}/${name}`,
        isDir,
        isSymlink,
        broken: false,
        hidden: name.startsWith('.')
      })
    } else {
      // Fallback from ls -1ap
      let name = line.trim()
      if (!name || name === './' || name === '../') continue
      const isDir = name.endsWith('/')
      if (isDir) name = name.slice(0, -1)
      entries.push({
        name,
        path: localDisplayPath.endsWith('/') || localDisplayPath.endsWith('\\')
          ? `${localDisplayPath}${name}`
          : `${localDisplayPath}/${name}`,
        isDir,
        isSymlink: false,
        broken: false,
        hidden: name.startsWith('.')
      })
    }
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  const listing: FsListing = {
    path: localDisplayPath,
    entries,
    truncated: entries.length >= 1000
  }

  listCache.set(cacheKey, { data: listing, timestamp: Date.now() })
  return { ok: true, data: listing }
}

/**
 * Read text or binary content of a remote file.
 */
export async function remoteReadFile(
  host: string,
  remotePath: string
): Promise<FsReadResult> {
  const cacheKey = `${host}|${remotePath}`
  const cached = readCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  // Stat file size first and base64 stream
  const script = `( [ -f ${shellQuote(remotePath)} ] || { echo '__DSH_ERR_NOT_FOUND__'; exit 1; }; ` +
    `base64 < ${shellQuote(remotePath)} 2>/dev/null )`

  const r = await runSsh(host, script)
  if (!r.ok) {
    if (r.stdout.includes('__DSH_ERR_NOT_FOUND__')) {
      return { ok: false, error: `远程文件不存在: ${remotePath}` }
    }
    return { ok: false, error: r.error || r.stderr || '读取文件失败' }
  }

  const rawB64 = r.stdout.replace(/\s+/g, '')
  let buffer: Buffer
  try {
    buffer = Buffer.from(rawB64, 'base64')
  } catch (e) {
    return { ok: false, error: '解码远程文件失败: ' + String(e) }
  }

  // Detect binary: check first 8000 bytes for NUL byte
  const probeSlice = buffer.subarray(0, Math.min(buffer.length, 8000))
  const isBinary = probeSlice.includes(0)

  let result: FsReadResult
  if (isBinary) {
    result = {
      ok: true,
      kind: 'binary',
      size: buffer.length,
      head: buffer.subarray(0, Math.min(buffer.length, 4096)).toString('base64'),
      truncated: buffer.length > MAX_BYTES
    }
  } else {
    result = {
      ok: true,
      kind: 'text',
      size: buffer.length,
      content: buffer.toString('utf8'),
      truncated: buffer.length > MAX_BYTES
    }
  }

  readCache.set(cacheKey, { data: result, timestamp: Date.now() })
  return result
}

/**
 * Atomically write content to a remote file.
 */
export async function remoteWriteFile(
  host: string,
  remotePath: string,
  content: string | Buffer
): Promise<{ ok: boolean; error?: string }> {
  const b64 = Buffer.isBuffer(content)
    ? content.toString('base64')
    : Buffer.from(String(content), 'utf8').toString('base64')

  const dirname = remotePath.split('/').slice(0, -1).join('/') || '.'
  const script = `mkdir -p ${shellQuote(dirname)} && base64 -d > ${shellQuote(remotePath)}`

  const r = await runSsh(host, script, b64)
  invalidateCache(host, remotePath)

  if (!r.ok) {
    return { ok: false, error: r.error || r.stderr || '远程文件保存失败' }
  }
  return { ok: true }
}

/**
 * Fast search in remote directory by file pattern / substring.
 */
export async function remoteSearchFiles(
  host: string,
  remotePath: string,
  localDisplayPath: string,
  query: string
): Promise<{ ok: boolean; entries: Array<{ path: string; isDir: boolean }>; truncated: boolean; error?: string }> {
  if (!query) return { ok: true, entries: [], truncated: false }

  const q = `*${query}*`
  const script = `( cd ${shellQuote(remotePath)} 2>/dev/null && ` +
    `find . -maxdepth 5 -name ${shellQuote(q)} 2>/dev/null | head -n 300 )`

  const r = await runSsh(host, script)
  if (!r.ok) {
    return { ok: false, entries: [], truncated: false, error: r.error || '远程搜索失败' }
  }

  const lines = r.stdout.split(/\r?\n/).filter(Boolean)
  const entries: Array<{ path: string; isDir: boolean }> = []

  for (const line of lines) {
    const rel = line.replace(/^\.\//, '')
    if (!rel) continue
    entries.push({
      path: localDisplayPath.endsWith('/') || localDisplayPath.endsWith('\\')
        ? `${localDisplayPath}${rel}`
        : `${localDisplayPath}/${rel}`,
      isDir: false
    })
  }

  return { ok: true, entries, truncated: entries.length >= 300 }
}

/**
 * Test SSH connection to host.
 */
export async function testSshConnection(host: string): Promise<{ ok: boolean; message: string }> {
  const r = await runSsh(host, 'echo "OK"', undefined, 8000)
  if (r.ok && r.stdout.includes('OK')) {
    return { ok: true, message: '连接成功！' }
  }
  return { ok: false, message: r.error || r.stderr || '连接失败' }
}
