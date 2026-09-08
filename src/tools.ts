import { posix } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseSshConfig, isValidSshHost } from './config'
import { runSsh, remoteReadFile, remoteWriteFile, shellQuote, shellCd, hasHostPassword } from './connection'
import { findRemoteWorkspaceMeta } from './workspace'

/** Helper to ensure returned objects are strictly lossless JSON (stripping undefined keys) */
function toCleanJson<T>(val: T): any {
  return JSON.parse(JSON.stringify(val))
}

function textRender(formatter: (args: any, value: any) => string) {
  return (args: any, value: any) => [{ type: 'text' as const, text: formatter(args, value) }]
}

function renderExec(v: any) {
  let text = String(v.stdout || '')
  if (v.stderr) {
    if (text && !text.endsWith('\n')) text += '\n'
    text += `[stderr]\n${v.stderr}`
  }
  if (!text) text = '(no output)'
  if (v.error && !text.includes(v.error)) {
    text += `\n[error: ${v.error}]`
  }
  if (v.exitCode !== undefined && v.exitCode !== 0) {
    text += `\n[exit code: ${v.exitCode}]`
  }
  return text
}

function resolveSessionCwd(ctx: any, exec: any): string | undefined {
  try {
    if (exec?.agent?.session?.header?.cwd) return exec.agent.session.header.cwd
    if (exec?.session?.header?.cwd) return exec.session.header.cwd
    if (exec?.agent?.session?.cwd) return exec.agent.session.cwd
    if (exec?.session?.cwd) return exec.session.cwd
    if (exec?.agent?.cwd) return exec.agent.cwd
    if (ctx?.agent?.session?.header?.cwd) return ctx.agent.session.header.cwd
    if (ctx?.agent?.session?.cwd) return ctx.agent.session.cwd
    if (ctx?.session?.header?.cwd) return ctx.session.header.cwd
    if (ctx?.session?.cwd) return ctx.session.cwd
  } catch {}
  return undefined
}

/**
 * Infer active host and remote root from execution context if user didn't specify.
 * Hardened with host validation and remote path traversal check.
 */
function resolveContext(ctx: any, args: { host?: string; path?: string; cwd?: string }, exec: any) {
  const sessionCwd = resolveSessionCwd(ctx, exec)
  const remoteInfo = findRemoteWorkspaceMeta(sessionCwd)
  const requestedPath = args.path !== undefined ? args.path : args.cwd

  // Host isolation: If inside a remote workspace, prevent executing against another host
  if (remoteInfo && args.host && args.host.toLowerCase() !== remoteInfo.meta.host.toLowerCase()) {
    return {
      host: null,
      remoteRoot: remoteInfo.meta.remotePath,
      resolvedPath: null,
      error: `工作区隔离拒绝：当前会话绑定远程主机 "${remoteInfo.meta.host}"，禁止跨主机向 "${args.host}" 执行操作`
    }
  }

  const host = args.host || remoteInfo?.meta.host
  const remoteRoot = remoteInfo?.meta.remotePath || '/'

  if (host && !isValidSshHost(host)) {
    return { host: null, remoteRoot, resolvedPath: null, error: `主机校验失败：主机 "${host}" 非法或不在 ~/.ssh/config 列表中` }
  }

  let resolvedPath = requestedPath
  if (resolvedPath !== undefined && resolvedPath !== '') {
    if (!resolvedPath.startsWith('/') && !resolvedPath.startsWith('~')) {
      resolvedPath = `${remoteRoot.replace(/\/+$/, '')}/${resolvedPath}`
    }
  } else {
    resolvedPath = remoteRoot
  }

  if (resolvedPath) {
    // Block any path escaping via ..
    const normCheck = posix.normalize(resolvedPath.replace(/\\/g, '/'))
    if (normCheck.startsWith('../') || normCheck === '..') {
      return { host, remoteRoot, resolvedPath: null, error: `路径遍历拦截：禁止使用 ".." 访问越权路径: "${requestedPath}"` }
    }

    if (remoteInfo) {
      if (resolvedPath.startsWith('~') && !remoteRoot.startsWith('~')) {
        return { host, remoteRoot, resolvedPath: null, error: `路径拦截：当前工作区目录限制在 "${remoteRoot}"，禁止跨越到用户家目录: "${requestedPath}"` }
      }
      const cleanBase = posix.normalize(remoteRoot.replace(/\\/g, '/'))
      const normTarget = posix.normalize(resolvedPath.replace(/\\/g, '/'))
      const baseWithSlash = cleanBase.endsWith('/') ? cleanBase : cleanBase + '/'
      if (cleanBase !== '/' && !normTarget.startsWith(baseWithSlash) && normTarget !== cleanBase) {
        return { host, remoteRoot, resolvedPath: null, error: `路径遍历拦截：禁止访问超出远程工作区目录的路径: "${requestedPath}"` }
      }
      resolvedPath = normTarget
    }
  }

  return { host, remoteRoot, resolvedPath, isRemoteWorkspace: !!remoteInfo, error: null }
}

function checkToolAuth(ctx: any, host: string, exec: any) {
  const sessionCwd = resolveSessionCwd(ctx, exec)
  const remoteInfo = findRemoteWorkspaceMeta(sessionCwd)
  if (remoteInfo && remoteInfo.meta.host === host && remoteInfo.meta.authType === 'password') {
    if (!hasHostPassword(host)) {
      return {
        ok: false,
        needAuth: true,
        host,
        error: `远程主机 ${host} 内存密码已过期，请在网页端弹出的密码框中确认后重试。`
      }
    }
  }
  return null
}

export function registerTools(ctx: any): () => void {
  const register = (tool: any) => ctx.tools.register(defineTool(tool))
  const disposers: Array<(() => void) | undefined> = []

  // 1. remote_ssh_hosts
  disposers.push(register({
    name: 'remote_ssh_hosts',
    description: '列出当前从 ~/.ssh/config 中发现的所有可用远程主机配置，以及当前会话绑定的远程工作区状态。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => JSON.stringify(v, null, 2))
    },
    execute: async (_args: any, exec: any) => {
      const hosts = parseSshConfig()
      const sessionCwd = resolveSessionCwd(ctx, exec)
      const info = findRemoteWorkspaceMeta(sessionCwd)
      return toCleanJson({
        hosts,
        currentRemote: info ? info.meta : null
      })
    }
  }))

  // 2. remote_ssh_exec
  disposers.push(register({
    name: 'remote_ssh_exec',
    description: '在远程 SSH 主机上执行 Shell 命令。如果在远程工作区中，可免填 host 并自动在远程工作区目录下执行。',
    parameters: {
      command: { type: 'string', required: true, description: '要在远程主机上执行的 Shell 命令' },
      host: { type: 'string', description: '可选，~/.ssh/config 中的主机别名（远程工作区会话中自动获取）' },
      cwd: { type: 'string', description: '可选，执行命令的工作目录（默认自动使用当前远程工作区根目录）' }
    },
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => renderExec(v))
    },
    execute: async (args: any, exec: any) => {
      const { host, remoteRoot, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec)
      if (ctxErr) {
        return toCleanJson({
          ok: false,
          exitCode: -1,
          stdout: '',
          stderr: ctxErr,
          error: ctxErr
        })
      }
      if (!host) {
        return toCleanJson({
          ok: false,
          exitCode: -1,
          stdout: '',
          stderr: '未指定 host，且当前会话不是远程工作区。请提供 host 参数（如 remote_ssh_hosts 中列出的主机）。',
          error: '未指定 host，且当前会话不是远程工作区'
        })
      }

      const authErr = checkToolAuth(ctx, host, exec)
      if (authErr) return toCleanJson(authErr)

      const execDir = args.cwd ? resolvedPath : remoteRoot
      let cmd = String(args.command || '').trim()
      if (execDir) {
        cmd = `${shellCd(execDir)} && ${cmd}`
      }

      const r = await runSsh(host, cmd)
      return toCleanJson({
        ok: r.ok,
        exitCode: r.exitCode ?? (r.ok ? 0 : 1),
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        error: r.error || null
      })
    }
  }))

  // 3. remote_ssh_read
  disposers.push(register({
    name: 'remote_ssh_read',
    description: '读取远程主机上的文件文本内容。',
    parameters: {
      path: { type: 'string', required: true, description: '远程文件路径（绝对路径，或相对远程工作区的相对路径）' },
      host: { type: 'string', description: '可选，~/.ssh/config 中的主机别名' }
    },
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => {
        if (!v.ok) return v.error || '读取失败'
        return v.content || '(空文件)'
      })
    },
    execute: async (args: any, exec: any) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec)
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr })
      if (!host) return toCleanJson({ ok: false, error: '未指定 host，且当前会话不是远程工作区' })
      if (!resolvedPath) return toCleanJson({ ok: false, error: 'path 不能为空' })

      const authErr = checkToolAuth(ctx, host, exec)
      if (authErr) return toCleanJson(authErr)

      const r = await remoteReadFile(host, resolvedPath)
      if (!r.ok) return toCleanJson({ ok: false, error: r.error || '读取失败' })
      return toCleanJson({
        ok: true,
        path: resolvedPath,
        kind: r.kind || 'text',
        content: r.content || '',
        size: r.size || 0,
        truncated: Boolean(r.truncated)
      })
    }
  }))

  // 4. remote_ssh_write
  disposers.push(register({
    name: 'remote_ssh_write',
    description: '在远程主机上创建或覆盖写入文件内容。',
    parameters: {
      path: { type: 'string', required: true, description: '远程文件路径（绝对路径，或相对远程工作区的相对路径）' },
      content: { type: 'string', required: true, description: '要写入的完整文本内容' },
      host: { type: 'string', description: '可选，~/.ssh/config 中的主机别名' }
    },
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => v.ok ? '写入成功' : (v.error || '写入失败'))
    },
    execute: async (args: any, exec: any) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec)
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr })
      if (!host) return toCleanJson({ ok: false, error: '未指定 host，且当前会话不是远程工作区' })
      if (!resolvedPath) return toCleanJson({ ok: false, error: 'path 不能为空' })

      const authErr = checkToolAuth(ctx, host, exec)
      if (authErr) return toCleanJson(authErr)

      const r = await remoteWriteFile(host, resolvedPath, args.content ?? '')
      return toCleanJson({
        ok: r.ok,
        error: r.error || null
      })
    }
  }))

  return () => {
    for (const dispose of disposers) {
      try { dispose?.() } catch {}
    }
  }
}

/**
 * Configure AI tools for remote workspace sessions only.
 * Non-remote workspaces will not have remote_ssh_* tools injected into their prompt/runtime.
 */
export function setupRemoteTools(ctx: any): () => void {
  const registeredAgents = new WeakSet<any>()
  const cleanups = new Map<any, () => void>()

  const maybeRegisterForAgent = (agent: any) => {
    if (!agent || registeredAgents.has(agent)) return

    const cwd = agent.session?.header?.cwd || agent.session?.cwd || agent.cwd
    const remoteInfo = findRemoteWorkspaceMeta(cwd)
    if (!remoteInfo) {
      // Non-remote workspace: strictly avoid injecting exclusive remote SSH tools
      return
    }

    const agentCtx = agent.ctx
    if (!agentCtx?.tools?.register) {
      if (typeof agentCtx?.inject === 'function') {
        agentCtx.inject(['tools'], () => {
          maybeRegisterForAgent(agent)
        })
      }
      return
    }

    // If tools are already visible in this agent's scope (e.g. subagent inheriting from parent scope), skip
    if (agentCtx.tools.get?.('remote_ssh_exec', agent)) {
      registeredAgents.add(agent)
      return
    }

    registeredAgents.add(agent)
    const dispose = registerTools(agentCtx)
    if (typeof dispose === 'function') {
      cleanups.set(agent, dispose)
    }
  }

  // 1. Scan already-loaded agents if agents service is present
  try {
    const list = ctx.agents?.list?.()
    if (Array.isArray(list)) {
      for (const agent of list) {
        maybeRegisterForAgent(agent)
      }
    }
  } catch {}

  // 2. Also hook into agents service if it is provided later
  if (typeof ctx.inject === 'function') {
    ctx.inject(['agents'], (agentCtx: any) => {
      try {
        const list = agentCtx.agents?.list?.()
        if (Array.isArray(list)) {
          for (const agent of list) {
            maybeRegisterForAgent(agent)
          }
        }
      } catch {}
    })
  }

  // 3. Hook newly created agents
  const stopCreated = ctx.on?.('agent/created', ({ agent }: any) => {
    maybeRegisterForAgent(agent)
  })

  // 4. Cleanup when agent is disposed
  const stopDisposed = ctx.on?.('agent/disposed', ({ agent }: any) => {
    const dispose = cleanups.get(agent)
    if (dispose) {
      cleanups.delete(agent)
      try { dispose() } catch {}
    }
  })

  return () => {
    stopCreated?.()
    stopDisposed?.()
    for (const dispose of cleanups.values()) {
      try { dispose() } catch {}
    }
    cleanups.clear()
  }
}
