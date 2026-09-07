import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isValidSshHost } from './config'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB file size limit
const MAX_STDOUT_BYTES = 16 * 1024 * 1024 // 16MB stream buffer to accommodate Base64 transfer overhead
const CACHE_TTL_MS = 5000 // 5 seconds LRU cache

export interface SshRunResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  error?: string
  stdoutTruncated?: boolean
}

export interface SshRunOptions {
  /** Use this password for this invocation without reading or mutating the cache. */
  password?: string
  /** Do not use or create a ControlMaster connection. */
  disableConnectionReuse?: boolean
  /** Restrict authentication to a direct password exchange. */
  passwordOnly?: boolean
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

// ---------------------------------------------------------------------------
// In-Memory Password Store (Zero-Disk Security)
// ---------------------------------------------------------------------------
const memoryPasswords = new Map<string, string>()

export function setHostPassword(host: string, pass?: string): void {
  if (!pass) {
    memoryPasswords.delete(host)
  } else {
    memoryPasswords.set(host, pass)
  }
}

export function getHostPassword(host: string): string | undefined {
  return memoryPasswords.get(host)
}

export function hasHostPassword(host: string): boolean {
  return memoryPasswords.has(host)
}

export function removeHostPassword(host: string): void {
  memoryPasswords.delete(host)
}

/**
 * Gracefully close the OpenSSH ControlMaster connection for host,
 * and clear stored credentials.
 */
export async function closeSshConnection(host: string): Promise<void> {
  removeHostPassword(host)
  if (!isValidSshHost(host)) return

  const socketDir = getSocketDir()
  const socketPath = join(socketDir, '%r@%h:%p')

  await new Promise<void>((resolve) => {
    const child = spawn('ssh', ['-O', 'exit', '-o', `ControlPath=${socketPath}`, '--', host], {
      stdio: 'ignore'
    })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolve()
    }, 3000)
  })
}

function getSocketDir(): string {
  const dir = join(homedir(), '.dsh', 'dsh-ssh', 'sockets')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  try {
    chmodSync(dir, 0o700)
  } catch {}
  return dir
}

export function shellQuote(p: string): string {
  if (!p) return "''"
  return "'" + String(p).replace(/'/g, "'\\''") + "'"
}

/**
 * Generate a safe cd command that correctly expands ~ (tilde) to $HOME
 * while keeping all subpaths strictly POSIX shell quoted.
 */
export function shellCd(targetPath: string): string {
  const p = String(targetPath || '').trim()
  if (!p || p === '~' || p === '~/' || p === '~\\') {
    return 'cd "$HOME" 2>/dev/null || cd ~ 2>/dev/null || cd'
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    const sub = p.slice(2)
    return `cd "$HOME"/${shellQuote(sub)} 2>/dev/null`
  }
  return `cd ${shellQuote(p)} 2>/dev/null`
}

function translateSshError(text: string): string {
  const t = String(text || '')
  if (/permission denied \(publickey,password/i.test(t)) {
    return 'SSH 认证失败：密码错误或公钥未配置。'
  }
  if (/permission denied \(publickey/i.test(t)) {
    return 'SSH 公钥认证失败：请确认私钥配置或目标主机的 ~/.ssh/authorized_keys 中已添加对应公钥。'
  }
  if (/permission denied/i.test(t)) {
    return 'SSH 认证失败：密码错误或无访问权限。'
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
  timeoutMs = 30000,
  options: SshRunOptions = {}
): Promise<SshRunResult> {
  if (!isValidSshHost(host)) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '',
      error: `SSH 主机校验失败：主机 "${host}" 不在合法 ~/.ssh/config 配置列表中或包含非法字符`
    }
  }

  const socketDir = getSocketDir()
  const socketPath = join(socketDir, '%r@%h:%p')

  const password = options.password !== undefined
    ? options.password
    : getHostPassword(host)

  const baseArgs = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ClearAllForwardings=yes'
  ]

  if (options.disableConnectionReuse) {
    // Password verification must not accidentally authenticate through an
    // already-running ControlMaster connection.
    baseArgs.push('-o', 'ControlMaster=no', '-o', 'ControlPath=none')
  } else {
    baseArgs.push(
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${socketPath}`,
      '-o', 'ControlPersist=10m'
    )
  }

  if (options.passwordOnly) {
    // Do not allow a configured key, agent, keyboard-interactive, GSSAPI, or
    // host-based method to make a wrong password look valid.
    baseArgs.push(
      '-o', 'PubkeyAuthentication=no',
      '-o', 'PreferredAuthentications=password',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'GSSAPIAuthentication=no',
      '-o', 'HostbasedAuthentication=no'
    )
  }

  if (!password) {
    baseArgs.push('-o', 'BatchMode=yes')
  }

  baseArgs.push('--', host, command)

  let bin = 'ssh'
  let finalArgs = baseArgs
  let env = process.env

  if (password) {
    bin = 'sshpass'
    finalArgs = ['-e', 'ssh', ...baseArgs]
    env = { ...process.env, SSHPASS: password }
  }

  return new Promise((resolve) => {
    let stdoutText = ''
    let stderrText = ''
    let stdoutTruncated = false
    let resolved = false

    const child = spawn(bin, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    const finish = (result: SshRunResult) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      try { child.stdin?.destroy() } catch {}
      try { child.stdout?.destroy() } catch {}
      try { child.stderr?.destroy() } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish({
        ok: false,
        exitCode: -1,
        stdout: stdoutText,
        stderr: stderrText,
        error: `SSH 命令执行超时 (${timeoutMs / 1000}s)`,
        stdoutTruncated
      })
    }, timeoutMs)

    if (child.stdin) {
      child.stdin.on('error', (_err: any) => {
        // EPIPE or ECONNRESET on stdin happens when the SSH process terminates early
        // (e.g. auth failure, immediate command failure, broken pipe).
        // Catching it prevents Node.js from throwing an unhandled 'error' event and crashing.
      })
    }

    if (stdinData !== undefined && child.stdin) {
      try {
        child.stdin.write(stdinData, () => {
          try { child.stdin?.end() } catch {}
        })
      } catch {
        // Write failures are caught by stdin.on('error') and child 'close'/'error'
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutText.length < MAX_STDOUT_BYTES) {
        const remain = MAX_STDOUT_BYTES - stdoutText.length
        if (chunk.length > remain) {
          stdoutText += chunk.subarray(0, remain).toString('utf8')
          stdoutTruncated = true
        } else {
          stdoutText += chunk.toString('utf8')
        }
      } else {
        stdoutTruncated = true
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrText.length < 512 * 1024) {
        stderrText += chunk.toString('utf8')
      }
    })

    child.on('error', (err) => {
      finish({
        ok: false,
        exitCode: -1,
        stdout: stdoutText,
        stderr: stderrText,
        error: 'SSH 进程启动失败: ' + err.message,
        stdoutTruncated
      })
    })

    child.on('close', (code) => {
      const exitCode = code ?? 0
      const ok = exitCode === 0
      const errHint = !ok ? (translateSshError(stderrText) || `SSH 退出码: ${exitCode}`) : undefined
      finish({
        ok,
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        error: errHint,
        stdoutTruncated
      })
    })
  })
}

// ---------------------------------------------------------------------------
// In-Memory Cache (LRU + TTL, Bounded to 100 entries)
// ---------------------------------------------------------------------------

interface CacheItem<T> {
  data: T
  timestamp: number
}

const MAX_CACHE_ENTRIES = 100
const listCache = new Map<string, CacheItem<FsListing>>()
const readCache = new Map<string, CacheItem<FsReadResult>>()

function setCacheItem<T>(map: Map<string, CacheItem<T>>, key: string, data: T): void {
  if (map.has(key)) {
    map.delete(key)
  } else if (map.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) {
      map.delete(oldestKey)
    }
  }
  map.set(key, { data, timestamp: Date.now() })
}

function getCacheItem<T>(map: Map<string, CacheItem<T>>, key: string): T | undefined {
  const item = map.get(key)
  if (!item) return undefined
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    map.delete(key)
    return undefined
  }
  map.delete(key)
  map.set(key, item)
  return item.data
}

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
  const cached = getCacheItem(listCache, cacheKey)
  if (cached) {
    // Return cached listing with updated display path
    return {
      ok: true,
      data: {
        path: localDisplayPath,
        entries: cached.entries.map((e) => ({
          ...e,
          path: localDisplayPath.endsWith('/') || localDisplayPath.endsWith('\\')
            ? `${localDisplayPath}${e.name}`
            : `${localDisplayPath}/${e.name}`
        })),
        truncated: cached.truncated
      }
    }
  }

  // Fast find printf command with fallback
  const script = `( ${shellCd(remotePath)} || { echo '__DSH_ERR_CD__'; exit 1; }; ` +
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

  setCacheItem(listCache, cacheKey, listing)
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
  const cached = getCacheItem(readCache, cacheKey)
  if (cached) {
    return cached
  }

  // Stat file size first, verify within MAX_FILE_BYTES, then stream Base64 with size and EOF markers
  const script = `( [ -f ${shellQuote(remotePath)} ] || { echo '__DSH_ERR_NOT_FOUND__'; exit 1; }; ` +
    `SIZE=$(wc -c < ${shellQuote(remotePath)} 2>/dev/null || stat -c %s ${shellQuote(remotePath)} 2>/dev/null || echo 0); ` +
    `if [ "$SIZE" -gt ${MAX_FILE_BYTES} ]; then echo "__DSH_ERR_TOO_LARGE__:$SIZE"; exit 1; fi; ` +
    `echo "__DSH_FILE_SIZE__:$SIZE"; ` +
    `base64 < ${shellQuote(remotePath)} 2>/dev/null; ` +
    `echo ""; ` +
    `echo "__DSH_READ_EOF__"; )`

  const r = await runSsh(host, script)
  if (!r.ok) {
    if (r.stdout.includes('__DSH_ERR_NOT_FOUND__')) {
      return { ok: false, error: `远程文件不存在: ${remotePath}` }
    }
    if (r.stdout.includes('__DSH_ERR_TOO_LARGE__')) {
      const match = r.stdout.match(/__DSH_ERR_TOO_LARGE__:(\d+)/)
      const sizeStr = match ? ` (${Math.round(Number(match[1]) / (1024 * 1024))}MB)` : ''
      return { ok: false, error: `远程文件过大${sizeStr}，超过 10MB 限制。为防止截断导致后续保存损坏文件，已拒绝读取。` }
    }
    return { ok: false, error: r.error || r.stderr || '读取文件失败' }
  }

  // Verify transmission completeness: EOF marker must exist and stdout must not be truncated
  if (!r.stdout.includes('__DSH_READ_EOF__') || r.stdoutTruncated) {
    return { ok: false, error: '远程文件读取未完成（数据传输中断或超过缓冲区限制），已拒绝解析以防文件损坏' }
  }

  const sizeMatch = r.stdout.match(/__DSH_FILE_SIZE__:(\d+)/)
  if (!sizeMatch) {
    return { ok: false, error: '未能获取远程文件大小元数据' }
  }
  const expectedSize = parseInt(sizeMatch[1], 10)

  // Extract base64 payload strictly between size marker and EOF marker
  const startIndex = r.stdout.indexOf(sizeMatch[0]) + sizeMatch[0].length
  const endIndex = r.stdout.indexOf('__DSH_READ_EOF__')
  const rawB64 = r.stdout.slice(startIndex, endIndex).replace(/\s+/g, '')

  let buffer: Buffer
  try {
    buffer = Buffer.from(rawB64, 'base64')
  } catch (e) {
    return { ok: false, error: '解码远程文件失败: ' + String(e) }
  }

  // Exact byte length integrity check
  if (buffer.length !== expectedSize) {
    return {
      ok: false,
      error: `远程文件完整性校验失败：预期大小 ${expectedSize} 字节，实际接收 ${buffer.length} 字节。已拒绝返回以防止损坏文件。`
    }
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
      truncated: false
    }
  } else {
    result = {
      ok: true,
      kind: 'text',
      size: buffer.length,
      content: buffer.toString('utf8'),
      truncated: false
    }
  }

  setCacheItem(readCache, cacheKey, result)
  return result
}

/**
 * Atomically write content to a remote file while strictly preserving file permissions.
 * Writes to a unique temp file with restrictive permissions (0600), applies original permissions
 * or safe defaults, and atomically renames via mv to avoid permission loosening or partial writes.
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
  const tmpPath = `${remotePath}.dsh-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const script = `mkdir -p ${shellQuote(dirname)} && ` +
    `( touch ${shellQuote(tmpPath)} 2>/dev/null && chmod 600 ${shellQuote(tmpPath)} 2>/dev/null && ` +
    `base64 -d > ${shellQuote(tmpPath)} && ` +
    `if [ -e ${shellQuote(remotePath)} ]; then ` +
    `chmod --reference=${shellQuote(remotePath)} ${shellQuote(tmpPath)} 2>/dev/null || { ` +
    `MODE=$(stat -c %a ${shellQuote(remotePath)} 2>/dev/null || stat -f %OLp ${shellQuote(remotePath)} 2>/dev/null || stat -f %Lp ${shellQuote(remotePath)} 2>/dev/null); ` +
    `[ -n "$MODE" ] && chmod "$MODE" ${shellQuote(tmpPath)} 2>/dev/null; }; ` +
    `else ` +
    `UM=$(umask 2>/dev/null || echo 077); ` +
    `CLEAN_UM=$(echo "$UM" | sed 's/^0*//' 2>/dev/null); ` +
    `[ -z "$CLEAN_UM" ] && CLEAN_UM="0"; ` +
    `MODE=$(printf '%03o' $(( 0666 & ~0$CLEAN_UM )) 2>/dev/null || echo 600); ` +
    `chmod "$MODE" ${shellQuote(tmpPath)} 2>/dev/null || chmod 600 ${shellQuote(tmpPath)} 2>/dev/null; ` +
    `fi && ` +
    `mv -f ${shellQuote(tmpPath)} ${shellQuote(remotePath)} ) || ` +
    `{ rm -f ${shellQuote(tmpPath)} 2>/dev/null; exit 1; }`

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
  const script = `( ${shellCd(remotePath)} && ` +
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
 *
 * A supplied password is deliberately scoped to this one connection attempt:
 * it is not written to the global cache until the caller has confirmed success.
 * Password attempts also bypass ControlMaster and all non-password methods so
 * an existing key or multiplexed session cannot make an incorrect password
 * appear valid.
 */
export async function testSshConnection(host: string, password?: string): Promise<{ ok: boolean; message: string }> {
  if (password !== undefined && !password) {
    return { ok: false, message: '密码不能为空' }
  }

  const hasPassword = password !== undefined
  const r = await runSsh(
    host,
    'echo "OK"',
    undefined,
    8000,
    hasPassword
      ? { password, disableConnectionReuse: true, passwordOnly: true }
      : undefined
  )
  if (r.ok && r.stdout.includes('OK')) {
    return { ok: true, message: '连接成功！' }
  }
  return { ok: false, message: r.error || r.stderr || '连接失败' }
}

export interface RemoteBrowseResult {
  ok: boolean
  currentPath?: string
  dirs?: string[]
  truncated?: boolean
  error?: string
}

/**
 * Safely browse remote directories for workspace creation folder picker.
 * Bounded to 200 directories and strips hidden folders.
 */
export async function remoteBrowseDirs(
  host: string,
  targetPath = '~'
): Promise<RemoteBrowseResult> {
  const p = targetPath.trim() || '~'
  if (/[\r\n\0]/.test(p)) {
    return { ok: false, error: '非法路径字符' }
  }

  const script =
    `( ${shellCd(p)} || { echo '__DSH_ERR_CD__'; exit 1; }; ` +
    `pwd -P; ` +
    `echo '__DSH_SEP__'; ` +
    `{ find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\\n' 2>/dev/null || ls -1dp */ 2>/dev/null; } | sort -f | head -n 201 )`

  const r = await runSsh(host, script, undefined, 8000)
  if (!r.ok) {
    if (r.stdout.includes('__DSH_ERR_CD__')) {
      return { ok: false, error: `无法访问该远程目录（不存在或无权限）: ${p}` }
    }
    return { ok: false, error: r.error || r.stderr || '读取远程目录失败' }
  }

  const parts = r.stdout.split('__DSH_SEP__')
  const absPath = parts[0]?.trim() || p
  const rawLines = (parts[1] || '').split(/\r?\n/)
  const dirSet = new Set<string>()

  for (const line of rawLines) {
    let name = line.trim()
    if (!name || name === '.' || name === '..' || name === './') continue
    if (name.endsWith('/')) name = name.slice(0, -1)
    if (name.startsWith('.')) continue
    dirSet.add(name)
  }

  const rawDirs = Array.from(dirSet)
  const truncated = rawDirs.length > 200
  const dirs = rawDirs.slice(0, 200)

  return {
    ok: true,
    currentPath: absPath,
    dirs,
    truncated
  }
}

