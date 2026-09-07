import { opendir, stat, readFile, writeFile, rename, mkdir, rm, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { findRemoteWorkspaceMeta, localToRemotePath } from './workspace'
import {
  remoteListDir,
  remoteReadFile,
  remoteWriteFile,
  remoteSearchFiles,
  hasHostPassword,
  removeHostPassword
} from './connection'

const MAX_BODY_BYTES = 10 * 1024 * 1024 // 10MB

/** Read and parse JSON request body */
async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      throw new Error('request body too large')
    }
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function writeJson(res: any, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function writeOk(res: any, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res: any, status = 400, message = 'operation failed'): void {
  writeJson(res, status, { ok: false, error: { code: 'fs-error', message } })
}

// ---------------------------------------------------------------------------
// Local FS Fallback Implementations (for local workspaces)
// ---------------------------------------------------------------------------

async function localListDir(targetPath: string) {
  const dir = targetPath || homedir()
  const level = await opendir(dir)
  const entries: any[] = []
  for await (const dirent of level) {
    if (entries.length >= 1000) break
    const isDir = dirent.isDirectory()
    const isSymlink = dirent.isSymbolicLink()
    entries.push({
      name: dirent.name,
      path: join(dir, dirent.name),
      isDir,
      isSymlink,
      broken: false,
      hidden: dirent.name.startsWith('.')
    })
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return { path: dir, entries, truncated: entries.length >= 1000 }
}

async function localReadText(filePath: string) {
  const s = await stat(filePath)
  if (s.isDirectory()) throw new Error('is a directory')
  const buffer = await readFile(filePath)
  const probe = buffer.subarray(0, Math.min(buffer.length, 8000))
  if (probe.includes(0)) {
    return {
      kind: 'binary',
      size: s.size,
      head: probe.subarray(0, Math.min(probe.length, 4096)).toString('base64'),
      truncated: false
    }
  }
  return {
    kind: 'text',
    content: buffer.toString('utf8'),
    truncated: false
  }
}

async function localWriteText(filePath: string, content: string) {
  const tmp = `${filePath}.dsh-ssh-tmp-${process.pid}`
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, filePath)
    return { ok: true }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

async function localSearch(rootDir: string, query: string) {
  if (!query) return { entries: [], truncated: false }
  const q = query.toLowerCase()
  const entries: any[] = []

  async function walk(dir: string, depth: number) {
    if (depth > 6 || entries.length >= 300) return
    try {
      const items = await readdir(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.name.toLowerCase().includes(q)) {
          entries.push({ path: join(dir, item.name), isDir: item.isDirectory() })
          if (entries.length >= 300) return
        }
        if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
          await walk(join(dir, item.name), depth + 1)
        }
      }
    } catch {}
  }

  await walk(rootDir, 0)
  return { entries, truncated: entries.length >= 300 }
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export function registerFsInterceptors(ctx: any) {
  const methods = ['fs.tree', 'fs.read', 'fs.write', 'fs.search']

  for (const method of methods) {
    ctx.effect(() => {
      return ctx.webServer.register({
        kind: 'exact',
        path: `/sidebar/api/${method}`,
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
            return
          }

          let payload: any = {}
          try {
            payload = await readJsonBody(req)
          } catch (e: any) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: e?.message || 'invalid json' } })
            return
          }

          try {
            // Determine active working directory / path
            let activeCwd = payload.cwd || ''
            if (!activeCwd && payload.sessionId && ctx.sessions) {
              const sess = ctx.sessions.get(payload.sessionId)
              activeCwd = sess?.header?.cwd || ''
            }
            if (!activeCwd && payload.path) {
              activeCwd = payload.path
            }

            // Check if this path belongs to a remote workspace
            const remoteInfo = findRemoteWorkspaceMeta(activeCwd) || (payload.path ? findRemoteWorkspaceMeta(payload.path) : null)

            if (remoteInfo) {
              // ==========================================
              // REMOTE WORKSPACE
              // ==========================================
              const { meta, anchorDir } = remoteInfo

              if (meta.authType === 'password' && !hasHostPassword(meta.host)) {
                writeJson(res, 401, {
                  ok: false,
                  needAuth: true,
                  host: meta.host,
                  error: { code: 'need-auth', message: `远程主机 ${meta.host} 需密码认证（内存密码已失效）` }
                })
                return
              }

              const handleAuthError = (result: any) => {
                if (meta.authType === 'password' && result.error && /认证失败|permission denied/i.test(result.error)) {
                  removeHostPassword(meta.host)
                  writeJson(res, 401, {
                    ok: false,
                    needAuth: true,
                    host: meta.host,
                    error: { code: 'need-auth', message: `远程主机 ${meta.host} 认证失败，请重新输入密码` }
                  })
                  return true
                }
                return false
              }

              if (method === 'fs.tree') {
                const targetLocal = payload.path || activeCwd || anchorDir
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath)
                const result = await remoteListDir(meta.host, remoteTarget, targetLocal)
                if (handleAuthError(result)) return
                if (result.ok && result.data) {
                  writeOk(res, result.data)
                } else {
                  writeError(res, 400, result.error)
                }
              } else if (method === 'fs.read') {
                const targetLocal = payload.path
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath)
                const result = await remoteReadFile(meta.host, remoteTarget)
                if (handleAuthError(result)) return
                if (result.ok) {
                  writeOk(res, result)
                } else {
                  writeError(res, 400, result.error)
                }
              } else if (method === 'fs.write') {
                const targetLocal = payload.path
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath)
                const result = await remoteWriteFile(meta.host, remoteTarget, payload.content || '')
                if (handleAuthError(result)) return
                if (result.ok) {
                  writeOk(res, { ok: true })
                } else {
                  writeError(res, 400, result.error)
                }
              } else if (method === 'fs.search') {
                const targetLocal = activeCwd || anchorDir
                const result = await remoteSearchFiles(meta.host, meta.remotePath, targetLocal, payload.query || '')
                if (handleAuthError(result)) return
                if (result.ok) {
                  writeOk(res, { entries: result.entries, truncated: result.truncated })
                } else {
                  writeError(res, 400, result.error)
                }
              }
            } else {
              // ==========================================
              // LOCAL WORKSPACE FALLBACK
              // ==========================================
              if (method === 'fs.tree') {
                const target = payload.path || activeCwd
                const result = await localListDir(target)
                writeOk(res, result)
              } else if (method === 'fs.read') {
                const result = await localReadText(payload.path)
                writeOk(res, result)
              } else if (method === 'fs.write') {
                const result = await localWriteText(payload.path, payload.content || '')
                writeOk(res, result)
              } else if (method === 'fs.search') {
                const target = activeCwd || homedir()
                const result = await localSearch(target, payload.query || '')
                writeOk(res, result)
              }
            }
          } catch (err: any) {
            writeError(res, 400, err?.message || String(err))
          }
        }
      })
    }, `dsh-ssh: intercept /sidebar/api/${method}`)
  }
}
