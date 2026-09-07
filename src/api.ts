import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSshConfig } from './config'
import { testSshConnection, remoteListDir } from './connection'
import { createRemoteWorkspace, deleteRemoteWorkspace, getWorkspacesDir, RemoteWorkspaceMeta } from './workspace'

const MAX_BODY_BYTES = 1024 * 1024 // 1MB

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
          if (method === 'hosts') {
            const hosts = parseSshConfig()
            sendJson(res, 200, { ok: true, hosts })
            return
          }

          if (method === 'workspaces') {
            const wsDir = getWorkspacesDir()
            const list: Array<{ anchorDir: string; meta: RemoteWorkspaceMeta }> = []
            if (existsSync(wsDir)) {
              for (const name of readdirSync(wsDir)) {
                const sub = join(wsDir, name)
                const jsonPath = join(sub, '.remote-ssh.json')
                if (existsSync(jsonPath)) {
                  try {
                    const meta = JSON.parse(readFileSync(jsonPath, 'utf8'))
                    list.push({ anchorDir: sub, meta })
                  } catch {}
                }
              }
            }
            sendJson(res, 200, { ok: true, workspaces: list })
            return
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'Method not allowed' })
            return
          }

          const body = await readJson(req)

          if (method === 'test') {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }
            const r = await testSshConnection(body.host)
            sendJson(res, 200, r)
            return
          }

          if (method === 'browse') {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: 'host is required' })
              return
            }
            const targetPath = body.path || '~'
            const r = await remoteListDir(body.host, targetPath, targetPath)
            if (r.ok && r.data) {
              // Return only directories for browsing
              const dirs = r.data.entries.filter((e) => e.isDir).map((e) => e.name)
              sendJson(res, 200, { ok: true, currentPath: targetPath, dirs })
            } else {
              sendJson(res, 400, { ok: false, error: r.error || 'Failed to list directory' })
            }
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
              body.title
            )
            sendJson(res, r.ok ? 200 : 400, r)
            return
          }

          if (method === 'delete-workspace') {
            if (!body.anchorDir) {
              sendJson(res, 400, { ok: false, error: 'anchorDir is required' })
              return
            }
            const r = await deleteRemoteWorkspace(ctx.workspaceRegistry, body.anchorDir)
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
