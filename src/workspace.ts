import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs'
import { join, dirname, basename, resolve, sep, posix } from 'node:path'
import { homedir } from 'node:os'
import { setHostPassword } from './connection'

export interface RemoteWorkspaceMeta {
  host: string
  remotePath: string
  title?: string
  createdAt: number
  authType?: 'key' | 'password'
}

export function getBaseDir(): string {
  const dir = join(homedir(), '.dsh', 'dsh-ssh')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getWorkspacesDir(): string {
  const dir = join(getBaseDir(), 'workspaces')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Scan upwards from path to find .remote-ssh.json
 */
export function findRemoteWorkspaceMeta(startPath?: string): { meta: RemoteWorkspaceMeta; anchorDir: string } | null {
  if (!startPath) return null
  let current = startPath
  const root = dirname(current)

  while (current && current !== root) {
    const metaPath = join(current, '.remote-ssh.json')
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RemoteWorkspaceMeta
        if (meta && meta.host && meta.remotePath) {
          return { meta, anchorDir: current }
        }
      } catch { }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * Translate a local path in the anchor workspace to the remote absolute path.
 * Hardened against path traversal attacks (../ escapes).
 */
export function localToRemotePath(localPath: string, anchorDir: string, remoteRoot: string): string {
  if (!localPath) return remoteRoot

  const normLocal = posix.normalize(localPath.replace(/\\/g, '/'))
  const normAnchor = posix.normalize(anchorDir.replace(/\\/g, '/'))
  const cleanBase = posix.normalize(remoteRoot.replace(/\\/g, '/'))

  let rel = ''
  if (normLocal === normAnchor) {
    return cleanBase
  }

  if (normLocal.startsWith(normAnchor.endsWith('/') ? normAnchor : normAnchor + '/')) {
    rel = normLocal.slice(normAnchor.length).replace(/^\/+/, '')
  } else {
    rel = posix.relative(normAnchor, normLocal)
  }

  if (!rel || rel === '.') return cleanBase

  // Resolve target path against cleanBase
  const candidate = posix.resolve(cleanBase, rel)

  // Containment check: candidate must stay within cleanBase
  if (cleanBase !== '/' && !candidate.startsWith(cleanBase.endsWith('/') ? cleanBase : cleanBase + '/') && candidate !== cleanBase) {
    return cleanBase
  }

  return candidate
}

/**
 * Create a new remote workspace anchor and register it into DSH workspaceRegistry.
 */
export async function createRemoteWorkspace(
  workspaceRegistry: any,
  host: string,
  remotePath: string,
  customTitle?: string,
  authType?: 'key' | 'password',
  password?: string
): Promise<{ ok: boolean; workspaceId?: string; anchorDir?: string; title?: string; error?: string }> {
  try {
    const id = 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    const anchorDir = join(getWorkspacesDir(), id)
    mkdirSync(anchorDir, { recursive: true })

    const cleanRemote = remotePath.trim().replace(/\/+$/, '') || '/'
    const folderName = basename(cleanRemote) || cleanRemote
    const title = customTitle || `${folderName} (${host})`

    const isPassword = authType === 'password'
    if (isPassword && password) {
      setHostPassword(host, password)
    }

    const meta: RemoteWorkspaceMeta = {
      host,
      remotePath: cleanRemote,
      title,
      createdAt: Date.now(),
      authType: isPassword ? 'password' : 'key'
    }

    writeFileSync(join(anchorDir, '.remote-ssh.json'), JSON.stringify(meta, null, 2), 'utf8')

    // Informational AGENTS.md in the anchor directory for models
    const agentsMd = [
      `# Remote Workspace: ${title}`,
      '',
      `This directory is a local anchor for remote SSH host: \`${host}\``,
      `Remote path: \`${cleanRemote}\``,
      '',
      'AI models must use `remote_ssh_*` tools (`remote_ssh_exec`, `remote_ssh_read`, `remote_ssh_write`) to directly execute commands and read/write remote files.'
    ].join('\n')
    writeFileSync(join(anchorDir, 'AGENTS.md'), agentsMd, 'utf8')

    let workspaceId: string | undefined
    if (workspaceRegistry && typeof workspaceRegistry.create === 'function') {
      const native = await workspaceRegistry.create(anchorDir, title)
      workspaceId = native?.id
    }

    return {
      ok: true,
      workspaceId,
      anchorDir,
      title
    }
  } catch (err: any) {
    return { ok: false, error: '创建远程工作区失败: ' + (err?.message || String(err)) }
  }
}

/**
 * Delete a remote workspace anchor and unregister from DSH.
 * Strict whitelist enforcement: anchorDir must strictly reside under getWorkspacesDir()
 * and cannot be the workspaces directory itself.
 */
export async function deleteRemoteWorkspace(
  workspaceRegistry: any,
  anchorDir: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const wsDir = resolve(getWorkspacesDir())
    const target = resolve(anchorDir)

    // Strict containment check: target must be inside wsDir and not wsDir itself
    if (!target.startsWith(wsDir + sep) || target === wsDir) {
      return { ok: false, error: '权限拒绝：只能删除位于 workspaces 目录下的远程工作区锚点目录' }
    }

    if (workspaceRegistry && typeof workspaceRegistry.resolveByPath === 'function') {
      const entity = await workspaceRegistry.resolveByPath(target)
      if (entity && typeof workspaceRegistry.delete === 'function') {
        await workspaceRegistry.delete(entity.id)
      }
    }
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: '删除远程工作区失败: ' + (err?.message || String(err)) }
  }
}

/**
 * Hook workspaceRegistry.delete to immediately delete the corresponding anchor directory
 * in ~/.dsh/dsh-ssh/workspaces/ when a workspace is removed.
 */
export function hookWorkspaceRegistryDeletion(ctx: any): void {
  const reg = ctx.workspaceRegistry
  if (!reg || typeof reg.delete !== 'function' || reg.__dshSshHooked) return

  reg.__dshSshHooked = true
  const originalDelete = reg.delete.bind(reg)
  const wsBaseDir = getWorkspacesDir().toLowerCase()

  reg.delete = async function (id: any) {
    let anchorToRemove: string | null = null
    try {
      const entity = typeof reg.get === 'function' ? reg.get(id) : null
      if (entity && entity.path) {
        const p = String(entity.path)
        let canon = p.toLowerCase()
        try { canon = realpathSync(p).toLowerCase() } catch { }
        if (canon.startsWith(wsBaseDir) || p.toLowerCase().startsWith(wsBaseDir)) {
          anchorToRemove = p
        }
      }
    } catch { }

    const result = await originalDelete(id)

    if (anchorToRemove) {
      try {
        if (existsSync(anchorToRemove)) {
          rmSync(anchorToRemove, { recursive: true, force: true })
          console.log('[dsh-ssh] Removed anchor directory on workspace deletion:', anchorToRemove)
        }
      } catch (err) {
        console.warn('[dsh-ssh] Failed to remove anchor directory:', anchorToRemove, err)
      }
    }

    return result
  }
}

/**
 * Install the shell wrapper script for dsh-better-sidebar terminal integration.
 */
export function ensureShellWrapper(): void {
  const baseDir = getBaseDir()

  // 1. dsh-remote-shell.js (Core cross-platform runner)
  const runnerJs = `// dsh-ssh terminal wrapper
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function shellQuote(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "'\\\\''") + "'";
}

let cur = process.cwd();
let meta = null;
const root = path.dirname(cur);

while (cur && cur !== root) {
  const p = path.join(cur, '.remote-ssh.json');
  if (fs.existsSync(p)) {
    try { meta = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    break;
  }
  const parent = path.dirname(cur);
  if (parent === cur) break;
  cur = parent;
}

if (meta && meta.host && typeof meta.host === 'string') {
  const host = meta.host.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(host) || host.startsWith('-')) {
    console.error('[dsh-ssh] 非法或不安全的 SSH 主机名: ' + host);
    process.exit(1);
  }
  const remotePath = meta.remotePath;
  let remoteCmd = undefined;
  if (remotePath) {
    remoteCmd = 'cd ' + shellQuote(remotePath) + ' 2>/dev/null; exec \${SHELL:-/bin/bash} -l';
  }
  const socketPath = path.join(require('os').homedir(), '.dsh', 'dsh-ssh', 'sockets', '%r@%h:%p');
  const args = ['-o', 'ControlMaster=auto', '-o', 'ControlPath=' + socketPath, '-tt', '--', host];
  if (remoteCmd) args.push(remoteCmd);

  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
} else {
  const defaultShell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const child = spawn(defaultShell, process.platform === 'win32' ? [] : ['-l'], { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
}
`
  writeFileSync(join(baseDir, 'dsh-remote-shell.js'), runnerJs, 'utf8')

  // 2. POSIX bash launcher
  const bashLauncher = `#!/bin/sh
exec node "$(dirname "$0")/dsh-remote-shell.js" "$@"
`
  const posixPath = join(baseDir, 'dsh-remote-shell')
  writeFileSync(posixPath, bashLauncher, 'utf8')
  try { chmodSync(posixPath, 0o755) } catch { }

  // 3. Win32 cmd launcher
  const cmdLauncher = `@echo off
node "%~dp0dsh-remote-shell.js" %*
`
  writeFileSync(join(baseDir, 'dsh-remote-shell.cmd'), cmdLauncher, 'utf8')
}
