import { parseSshConfig, isValidSshHost } from './config'
import { testSshConnection, setHostPassword, remoteBrowseDirs } from './connection'
import { createRemoteWorkspace } from './workspace'
import { isSafeRequest } from './interceptor'

const MAX_BODY_BYTES = 1024 * 1024 // 1MB

// Simple in-memory brute force protection. The key is normalized so casing or
// surrounding whitespace cannot create a second limiter bucket. inFlight
// reserves concurrent attempts before the SSH connection is started.
interface FailedAttemptRecord {
  count: number
  lockedUntil: number
  inFlight: number
}

const failedAttempts = new Map<string, FailedAttemptRecord>()

function rateLimitKey(host: string): string {
  return host.trim().toLowerCase()
}

function rateLimitMessage(remainingSeconds: number): string {
  return `认证失败次数过多，为防止目标主机账户被锁定，请在 ${remainingSeconds} 秒后重试`
}

/** Reserve one password attempt, or return a lockout message. */
function checkRateLimit(host: string): string | null {
  const key = rateLimitKey(host)
  const now = Date.now()
  let record = failedAttempts.get(key)

  if (record && record.lockedUntil > 0 && record.lockedUntil <= now && record.count >= 5 && record.inFlight === 0) {
    failedAttempts.delete(key)
    record = undefined
  }

  if (record && record.lockedUntil > now) {
    return rateLimitMessage(Math.ceil((record.lockedUntil - now) / 1000))
  }

  // Count outstanding attempts as well as completed failures. This prevents a
  // burst of concurrent requests from bypassing the five-attempt threshold.
  if (record && record.count + record.inFlight >= 5) {
    record.lockedUntil = now + 30000
    failedAttempts.set(key, record)
    return rateLimitMessage(30)
  }

  const next = record || { count: 0, lockedUntil: 0, inFlight: 0 }
  next.inFlight += 1
  failedAttempts.set(key, next)
  return null
}

function recordAttemptResult(host: string, success: boolean) {
  const key = rateLimitKey(host)
  const current = failedAttempts.get(key) || { count: 0, lockedUntil: 0, inFlight: 0 }
  current.inFlight = Math.max(0, current.inFlight - 1)

  if (success) {
    current.count = 0
    current.lockedUntil = 0
  } else {
    current.count += 1
    if (current.count >= 5) {
      current.lockedUntil = Date.now() + 30000 // 30s lockout
    }
  }

  if (current.count === 0 && current.inFlight === 0) {
    failedAttempts.delete(key)
  } else {
    failedAttempts.set(key, current)
  }
}

interface PasswordVerificationResult {
  ok: boolean
  message: string
  rateLimited?: boolean
}

/** Verify a supplied password without caching it until verification succeeds. */
async function verifyAndCachePassword(host: string, password: string): Promise<PasswordVerificationResult> {
  const rateErr = checkRateLimit(host)
  if (rateErr) {
    return { ok: false, message: rateErr, rateLimited: true }
  }

  try {
    const result = await testSshConnection(host, password)
    recordAttemptResult(host, result.ok)
    if (result.ok) {
      setHostPassword(host, password)
    }
    return result
  } catch (err: any) {
    recordAttemptResult(host, false)
    return { ok: false, message: err?.message || String(err) || '密码验证失败' }
  }
}

async function readJson(req: any): Promise<any> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new Error('Body too large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function sendJson(res: any, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

export function registerApiRoutes(ctx: any) {
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-ssh/api',
      handler: async (req: any, res: any) => {
        const url = new URL(req.url || '/', 'http://dsh.internal')
        const method = url.pathname.slice('/dsh-ssh/api/'.length).replace(/\/+$/, '')

        try {
          if (!isSafeRequest(req)) {
            sendJson(res, 403, { ok: false, error: '跨站或非法请求源被拦截 (Cross-site request blocked)' })
            return
          }

          if (method === 'hosts') {
            const rawHosts = parseSshConfig()
            const sanitizedHosts = rawHosts.map((h) => ({
              host: h.host,
              hostName: h.hostName,
              user: h.user,
              port: h.port,
              hasIdentityFile: Boolean(h.identityFile),
              proxyJump: h.proxyJump,
              passwordAuthentication: h.passwordAuthentication
            }))
            sendJson(res, 200, { ok: true, hosts: sanitizedHosts })
            return
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'Method not allowed' })
            return
          }

          const body = await readJson(req)
          const host = typeof body.host === 'string' ? body.host.trim() : body.host

          if (host && !isValidSshHost(host)) {
            sendJson(res, 400, { ok: false, error: `非法或不在 ~/.ssh/config 列表中的主机名: "${body.host}"` })
            return
          }

          if (method === 'auth-submit') {
            if (!host || typeof body.password !== 'string' || !body.password) {
              sendJson(res, 400, { ok: false, error: 'host and password are required' })
              return
            }
            const r = await verifyAndCachePassword(host, body.password)
            if (r.rateLimited) {
              sendJson(res, 429, { ok: false, error: r.message })
            } else if (r.ok) {
              sendJson(res, 200, { ok: true, message: '认证成功' })
            } else {
              sendJson(res, 400, { ok: false, error: r.message || '密码验证失败' })
            }
            return
          }

          if (method === 'test') {
            if (!host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }

            if (body.password !== undefined) {
              if (typeof body.password !== 'string' || !body.password) {
                sendJson(res, 400, { ok: false, error: 'password must be a non-empty string' })
                return
              }
              const r = await verifyAndCachePassword(host, body.password)
              if (r.rateLimited) {
                sendJson(res, 429, { ok: false, error: r.message })
              } else {
                sendJson(res, 200, { ok: r.ok, message: r.message })
              }
            } else {
              const r = await testSshConnection(host)
              sendJson(res, 200, r)
            }
            return
          }

          if (method === 'browse') {
            if (!host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }
            if (body.password !== undefined) {
              if (typeof body.password !== 'string' || !body.password) {
                sendJson(res, 400, { ok: false, error: 'password must be a non-empty string' })
                return
              }
              const auth = await verifyAndCachePassword(host, body.password)
              if (auth.rateLimited) {
                sendJson(res, 429, { ok: false, error: auth.message })
                return
              }
              if (!auth.ok) {
                sendJson(res, 400, { ok: false, error: auth.message || '密码验证失败' })
                return
              }
            }
            const r = await remoteBrowseDirs(host, body.path || '~')
            sendJson(res, r.ok ? 200 : 400, r)
            return
          }

          if (method === 'create-workspace') {
            if (!host || !body.remotePath) {
              sendJson(res, 400, { ok: false, error: 'host and remotePath are required' })
              return
            }

            if (body.authType === 'password') {
              if (typeof body.password !== 'string' || !body.password) {
                sendJson(res, 400, { ok: false, error: 'password must be a non-empty string' })
                return
              }
              const auth = await verifyAndCachePassword(host, body.password)
              if (auth.rateLimited) {
                sendJson(res, 429, { ok: false, error: auth.message })
                return
              }
              if (!auth.ok) {
                sendJson(res, 400, { ok: false, error: auth.message || '密码验证失败' })
                return
              }
            }

            const r = await createRemoteWorkspace(
              ctx.workspaceRegistry,
              host,
              body.remotePath,
              body.title,
              body.authType
            )
            sendJson(res, r.ok ? 200 : 400, r)
            return
          }

          sendJson(res, 404, { ok: false, error: 'Unknown API method: ' + method })
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: err?.message || String(err) })
        }
      }
    })
  }, 'dsh-ssh: /dsh-ssh/api prefix route')
}
