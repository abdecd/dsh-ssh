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

/**
 * CSRF / Origin & Port validation for HTTP endpoints.
 * Strictly enforces protocol, host, and port matching against Host header.
 * Eliminates cross-origin and cross-port CSRF risks from localhost or external domains.
 */
export function isSafeRequest(req: any): boolean {
  const headers = req.headers || {}
  const secFetchSite = headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') {
    return false
  }

  // Reject simple request formats commonly abused in CSRF attacks
  const ct = (headers['content-type'] || '').toLowerCase()
  if (ct.includes('form') || ct.includes('multipart') || (ct.startsWith('text/') && !ct.includes('json'))) {
    return false
  }

  const origin = headers['origin'] || headers['referer']

  // If no Origin/Referer is provided:
  if (!origin) {
    // If request contains browser-only fetch metadata headers but missing Origin/Referer, reject
    if (headers['sec-fetch-dest'] || headers['sec-fetch-mode'] || headers['sec-ch-ua']) {
      return false
    }
    // Only allow non-browser clients if they originate from loopback IP or internal socket
    const remoteAddr = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim()
    const isLoopback = !remoteAddr ||
      remoteAddr === '127.0.0.1' ||
      remoteAddr === '::1' ||
      remoteAddr === '::ffff:127.0.0.1'
    return isLoopback
  }

  try {
    const originUrl = new URL(origin)
    const hostHeader = String(headers['host'] || '').trim().toLowerCase()
    if (!hostHeader) return false

    // Parse expected host and port from Host header
    let expectedHost = hostHeader
    let expectedPort = ''
    if (hostHeader.startsWith('[')) {
      // IPv6 format: [::1]:3080
      const closeBracket = hostHeader.indexOf(']')
      expectedHost = hostHeader.slice(1, closeBracket)
      expectedPort = hostHeader.slice(closeBracket + 1).replace(/^:/, '')
    } else if (hostHeader.includes(':')) {
      const parts = hostHeader.split(':')
      expectedHost = parts[0]
      expectedPort = parts[1]
    }

    const isEncrypted = Boolean(req.socket?.encrypted || req.connection?.encrypted || headers['x-forwarded-proto'] === 'https')
    if (!expectedPort) {
      expectedPort = isEncrypted ? '443' : '80'
    }

    const actualHost = originUrl.hostname.toLowerCase().replace(/^[\[]|[\]]$/g, '')
    const actualPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')

    // 1. Strict Port Check: ports must be identical!
    if (actualPort !== expectedPort) {
      return false
    }

    // 2. Host Matching: must match Host header, or be an equivalent loopback alias on the same port
    if (actualHost === expectedHost) {
      return true
    }

    const loopbackAliases = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])
    if (loopbackAliases.has(actualHost) && loopbackAliases.has(expectedHost)) {
      return true
    }

    return false
  } catch {
    return false
  }
}

/** Read raw buffer and parse JSON request body */
async function readRawBody(req: any): Promise<{ buffer: Buffer; payload: any }> {
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
  const buffer = Buffer.concat(chunks)
  const text = buffer.toString('utf8')
  const payload = text.trim() ? JSON.parse(text) : {}
  return { buffer, payload }
}

/** Replay the consumed request stream for downstream handlers */
function replayRequest(req: any, buffer: Buffer): any {
  return new Proxy(req, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return async function* () {
          yield buffer
        }
      }
      const val = Reflect.get(target, prop, receiver)
      if (typeof val === 'function') {
        return val.bind(target)
      }
      return val
    }
  })
}

/** Find the underlying prefix route handler registered on webServer (e.g. dsh-better-sidebar) */
function getOriginalPrefixHandler(ctx: any, pathname: string) {
  const ws = ctx.webServer
  if (!ws || !ws.prefixes) return null
  let best: any = undefined
  for (const [prefix, route] of ws.prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (best === undefined || prefix.length > best.path.length) {
        best = route
      }
    }
  }
  return best?.handler
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

          if (!isSafeRequest(req)) {
            writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: '跨站或非法请求源被拦截 (Cross-site request blocked)' } })
            return
          }

          let raw: { buffer: Buffer; payload: any }
          try {
            raw = await readRawBody(req)
          } catch (e: any) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: e?.message || 'invalid json' } })
            return
          }

          const payload = raw.payload

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
              // REMOTE WORKSPACE: Handled by dsh-ssh
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

              try {
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
              } catch (traversalErr: any) {
                writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: traversalErr?.message || '访问被拒绝：超出远程工作区范围' } })
                return
              }
            } else {
              // ==========================================
              // LOCAL WORKSPACE: Transparent pass-through to original route handler
              // ==========================================
              const originalHandler = getOriginalPrefixHandler(ctx, `/sidebar/api/${method}`)
              if (typeof originalHandler === 'function') {
                await originalHandler(replayRequest(req, raw.buffer), res)
                return
              }
              writeJson(res, 404, {
                ok: false,
                error: { code: 'not-found', message: 'No underlying handler registered for local workspace route' }
              })
            }
          } catch (err: any) {
            writeError(res, 400, err?.message || String(err))
          }
        }
      })
    }, `dsh-ssh: intercept /sidebar/api/${method}`)
  }
}
