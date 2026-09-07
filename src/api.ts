import { parseSshConfig, isValidSshHost } from './config'
import { testSshConnection, setHostPassword, remoteBrowseDirs } from './connection'
import { createRemoteWorkspace } from './workspace'
import { isSafeRequest } from './interceptor'

const MAX_BODY_BYTES = 1024 * 1024 // 1MB

// Simple in-memory brute force protection
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>()

function checkRateLimit(host: string): string | null {
  const record = failedAttempts.get(host)
  if (!record) return null
  if (record.lockedUntil > Date.now()) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000)
    return `认证失败次数过多，为防止目标主机账户被锁定，请在 ${remaining} 秒后重试`
  }
  if (record.lockedUntil <= Date.now() && record.count >= 5) {
    failedAttempts.delete(host)
  }
  return null
}

function recordAttemptResult(host: string, success: boolean) {
  if (success) {
    failedAttempts.delete(host)
    return
  }
  const current = failedAttempts.get(host) || { count: 0, lockedUntil: 0 }
  current.count += 1
  if (current.count >= 5) {
    current.lockedUntil = Date.now() + 30000 // 30s lockout
  }
  failedAttempts.set(host, current)
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

          if (body.host && !isValidSshHost(body.host)) {
            sendJson(res, 400, { ok: false, error: `非法或不在 ~/.ssh/config 列表中的主机名: "${body.host}"` })
            return
          }

          if (method === 'auth-submit') {
            if (!body.host || !body.password) {
              sendJson(res, 400, { ok: false, error: 'host and password are required' })
              return
            }
            const rateErr = checkRateLimit(body.host)
            if (rateErr) {
              sendJson(res, 429, { ok: false, error: rateErr })
              return
            }
            const r = await testSshConnection(body.host, body.password)
            recordAttemptResult(body.host, r.ok)
            if (r.ok) {
              setHostPassword(body.host, body.password)
              sendJson(res, 200, { ok: true, message: '认证成功' })
            } else {
              sendJson(res, 400, { ok: false, error: r.message || '密码验证失败' })
            }
            return
          }

          if (method === 'test') {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }
            const rateErr = checkRateLimit(body.host)
            if (rateErr) {
              sendJson(res, 429, { ok: false, error: rateErr })
              return
            }
            const r = await testSshConnection(body.host, body.password)
            recordAttemptResult(body.host, r.ok)
            sendJson(res, 200, r)
            return
          }

          if (method === 'browse') {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }
            if (body.password) {
              setHostPassword(body.host, body.password)
            }
            const r = await remoteBrowseDirs(body.host, body.path || '~')
            sendJson(res, r.ok ? 200 : 400, r)
            return
          }

          if (method === 'create-workspace') {
            if (!body.host || !body.remotePath) {
              sendJson(res, 400, { ok: false, error: 'host and remotePath are required' })
              return
            }
            const r = await createRemoteWorkspace(
              ctx.workspaceRegistry,
              body.host,
              body.remotePath,
              body.title,
              body.authType,
              body.password
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
