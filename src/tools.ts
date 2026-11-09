import { posix } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isValidSshHost } from './config'
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
    if (text && !text.endsWith("\n")) text += "\n"
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
    if (ctx?.session?.header?.cwd) return ctx.session.header.cwd
    if (ctx?.session?.cwd) return ctx.session.cwd
  } catch {}
  return undefined
}

/**
 * Infer active host and remote root from execution context if user didn't specify.
 * Hardened with host validation and remote path traversal check.
 */
function resolveContext(ctx: any, args: { host?: string; path?: string; file_path?: string; cwd?: string }, exec: any) {
  const sessionCwd = resolveSessionCwd(ctx, exec)
  const remoteInfo = findRemoteWorkspaceMeta(sessionCwd)
  const requestedPath = args.file_path !== undefined ? args.file_path : (args.path !== undefined ? args.path : args.cwd)

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

/**
 * Deep redaction for sensitive credentials in file content.
 * All paths are allowed to be read, but sensitive contents (private keys, API keys,
 * passwords, tokens) are intercepted and replaced with [REDACTED].
 */
function redactSensitiveContent(content: string): string {
  let text = content

  // 1. Private key blocks (entire body between BEGIN and END)
  text = text.replace(
    /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g,
    '$1\n[REDACTED]\n$2'
  )

  // 2. Database & URL connection strings with embedded passwords
  text = text.replace(
    /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s\/]+:)([^@\s\/]+)(@)/g,
    '$1[REDACTED]$3'
  )

  // 3. Known API keys and service tokens by standard prefix
  text = text.replace(
    /\b(sk-[a-zA-Z0-9_-]{20,}|sk-or-v1-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,}|glpat-[a-zA-Z0-9_-]{20,}|npm_[a-zA-Z0-9]{36}|hf_[a-zA-Z0-9]{34,}|(?:AKIA|ASIA|LTAI|AKID)[A-Z0-9]{16,}|xox[baprs]-[0-9a-zA-Z]{10,}|(?:sk_live|rk_test|whsec)_[a-zA-Z0-9]{20,})\b/g,
    '[REDACTED]'
  )

  // 4. JSON Web Tokens (JWT)
  text = text.replace(
    /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g,
    '[REDACTED]'
  )

  // 5. Config / Env assignments: PASSWORD=..., API_KEY: ...
  text = text.replace(
    /(\b[A-Za-z0-9_]*(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*["']?)([^"'\r\n\s]{8,})(["']?)/gi,
    '$1[REDACTED]$3'
  )

  return text
}

const READ_DEFAULT_LIMIT = 2000
const READ_MAX_LIMIT = 2000
const READ_MAX_LINE_LENGTH = 2000
const READ_MAX_BYTES = 51200 // 50KB cap

interface ReadWindowOutcome {
  path: string
  offset: number
  lines: Array<{ number: number; text: string }>
  totalLines: number
  truncatedByBytes?: boolean
}

function buildReadWindow(
  rawContent: string,
  displayPath: string,
  requestedOffset?: number,
  requestedLimit?: number
): ReadWindowOutcome {
  const safeContent = redactSensitiveContent(rawContent)
  const rawLines = safeContent.split(/\r?\n/)
  const totalLines = rawContent === '' ? 0 : rawLines.length

  const offset = Math.max(1, Number.isInteger(requestedOffset) ? (requestedOffset as number) : 1)
  const limit = Math.max(1, Math.min(READ_MAX_LIMIT, Number.isInteger(requestedLimit) ? (requestedLimit as number) : READ_DEFAULT_LIMIT))

  if (totalLines === 0) {
    return {
      path: displayPath,
      offset,
      lines: [],
      totalLines: 0
    }
  }

  const selectedLines: Array<{ number: number; text: string }> = []
  let accumulatedBytes = 0
  let truncatedByBytes = false

  const startIndex = offset - 1
  for (let i = 0; i < limit && startIndex + i < totalLines; i++) {
    const lineIndex = startIndex + i
    let lineText = rawLines[lineIndex] ?? ''

    if (lineText.length > READ_MAX_LINE_LENGTH) {
      lineText = lineText.slice(0, READ_MAX_LINE_LENGTH) + ` ... (line truncated to ${READ_MAX_LINE_LENGTH} chars)`
    }

    const lineBytes = Buffer.byteLength(lineText, 'utf8') + 1
    if (selectedLines.length > 0 && accumulatedBytes + lineBytes > READ_MAX_BYTES) {
      truncatedByBytes = true
      break
    }

    accumulatedBytes += lineBytes
    selectedLines.push({
      number: lineIndex + 1,
      text: lineText
    })
  }

  return {
    path: displayPath,
    offset,
    lines: selectedLines,
    totalLines,
    truncatedByBytes
  }
}

function formatReadOutput(displayPath: string, outcome: ReadWindowOutcome): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1)
  let footer: string
  if (outcome.totalLines === 0) {
    footer = '(End of file - total 0 lines)'
  } else if (outcome.truncatedByBytes) {
    footer = `(Output capped. Showing lines ${outcome.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`
  } else if (endLine < outcome.totalLines) {
    footer = `(Showing lines ${outcome.offset}-${endLine} of ${outcome.totalLines}. Use offset=${endLine + 1} to continue.)`
  } else {
    footer = `(End of file - total ${outcome.totalLines} lines)`
  }

  const linesBody = outcome.lines.map(l => `${l.number}: ${l.text}`).join('\n')
  const content = outcome.lines.length > 0
    ? `${linesBody}\n\n${footer}`
    : footer

  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${content}\n</content>`
}

export function registerTools(ctx: any): () => void {
  const register = (tool: any) => ctx.tools.register(defineTool(tool))
  const disposers: Array<(() => void) | undefined> = []

  // 1. remote_ssh_exec
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
          stderr: '未指定 host，且当前会话不是远程工作区',
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

  // 2. remote_ssh_read
  disposers.push(register({
    name: 'remote_ssh_read',
    description: '读取远程主机上的文件文本内容，返回带行号的内容与分页结果。支持通过 offset 和 limit 进行大文件分页读取。',
    parameters: {
      file_path: { type: 'string', description: '远程文件路径（绝对路径，或相对远程工作区的相对路径）' },
      path: { type: 'string', description: '可选，与 file_path 等价，保持向后兼容' },
      offset: { type: 'number', description: '可选，1-based 起始行号（默认为 1）' },
      limit: { type: 'number', description: '可选，本次读取最大行数（默认为 2000，上限 2000）' },
      host: { type: 'string', description: '可选，~/.ssh/config 中的主机别名（远程工作区中可免填）' }
    },
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => {
        if (!v.ok) return v.error || '读取失败'
        return formatReadOutput(v.path, v)
      })
    },
    execute: async (args: any, exec: any) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec)
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr })
      if (!host) return toCleanJson({ ok: false, error: '未指定 host，且当前会话不是远程工作区' })
      if (!resolvedPath) return toCleanJson({ ok: false, error: 'file_path 不能为空' })

      // Path reading is fully allowed; file content is deeply redacted upon reading

      const authErr = checkToolAuth(ctx, host, exec)
      if (authErr) return toCleanJson(authErr)

      const r = await remoteReadFile(host, resolvedPath)
      if (!r.ok) return toCleanJson({ ok: false, error: r.error || '读取失败' })
      if (r.kind === 'binary') {
        return toCleanJson({ ok: false, error: `无法读取 "${resolvedPath}": 该文件为二进制文件` })
      }

      const window = buildReadWindow(r.content || '', resolvedPath, args.offset, args.limit)
      return toCleanJson({
        ok: true,
        path: window.path,
        offset: window.offset,
        lines: window.lines,
        totalLines: window.totalLines,
        truncatedByBytes: Boolean(window.truncatedByBytes)
      })
    }
  }))

  // 3. remote_ssh_write (commented out as bash / remote_ssh_exec flexibly handles remote file writing)
  /*
  disposers.push(register({
    name: 'remote_ssh_write',
    description: '在远程主机上创建或覆盖写入文件内容。',
    parameters: {
      file_path: { type: 'string', description: '远程文件路径（绝对路径，或相对远程工作区的相对路径）' },
      path: { type: 'string', description: '可选，与 file_path 等价，保持向后兼容' },
      content: { type: 'string', required: true, description: '要写入的完整文本内容' },
      host: { type: 'string', description: '可选，~/.ssh/config 中的主机别名' }
    },
    output: {
      schema: { type: 'json' },
      render: textRender((_, v) => v.ok ? `<path>${v.path}</path>\n<type>file</type>\n<content>\n${v.operation === 'create' ? 'Created' : 'Updated'} file\n</content>` : (v.error || '写入失败'))
    },
    execute: async (args: any, exec: any) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec)
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr })
      if (!host) return toCleanJson({ ok: false, error: '未指定 host，且当前会话不是远程工作区' })
      if (!resolvedPath) return toCleanJson({ ok: false, error: 'file_path 不能为空' })

      if (isSensitiveKeyPath(resolvedPath)) {
        return toCleanJson({ ok: false, error: `[安全拦截] 禁止修改或写入私钥敏感文件: "${resolvedPath}"` })
      }

      const authErr = checkToolAuth(ctx, host, exec)
      if (authErr) return toCleanJson(authErr)

      const r = await remoteWriteFile(host, resolvedPath, args.content ?? '')
      return toCleanJson({
        ok: r.ok,
        path: resolvedPath,
        operation: 'update',
        error: r.error || null
      })
    }
  }))
  */

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
