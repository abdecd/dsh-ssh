import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs'
import { join, dirname, basename, resolve, sep, posix } from 'node:path'
import { homedir } from 'node:os'
import { isValidSshHost } from './config'
import { closeSshConnection } from './connection'

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
 * Scan and resolve remote workspace metadata for a given path.
 * Strict security boundary:
 * Only workspaces managed by dsh-ssh in ~/.dsh/dsh-ssh/workspaces/<id> are recognized.
 * Unmanaged / arbitrary user project directories containing .remote-ssh.json are strictly ignored.
 */
export function findRemoteWorkspaceMeta(startPath?: string): { meta: RemoteWorkspaceMeta; anchorDir: string } | null {
  if (!startPath) return null

  try {
    const wsBaseDir = resolve(getWorkspacesDir())
    const prefixWithSep = wsBaseDir.endsWith(sep) ? wsBaseDir : wsBaseDir + sep

    const target = resolve(startPath)
    let canon = target
    try { canon = realpathSync(target) } catch { }

    // Path must strictly reside within getWorkspacesDir() and cannot be the base directory itself
    if (!canon.startsWith(prefixWithSep) || canon === wsBaseDir) {
      return null
    }

    const rel = posix.normalize(canon.slice(prefixWithSep.length).replace(/\\/g, '/'))
    const anchorName = rel.split('/')[0]
    if (!anchorName || anchorName === '.' || anchorName === '..') {
      return null
    }

    const anchorDir = join(wsBaseDir, anchorName)
    const metaPath = join(anchorDir, '.remote-ssh.json')
    if (!existsSync(metaPath)) {
      return null
    }

    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RemoteWorkspaceMeta
    if (meta && meta.host && meta.remotePath && isValidSshHost(meta.host)) {
      return { meta, anchorDir }
    }
  } catch { }

  return null
}

/**
 * Translate a local path in the anchor workspace to the remote absolute path.
 * Hardened against path traversal attacks (../ escapes).
 * Throws on path traversal attempts outside workspace boundaries.
 */
export function localToRemotePath(localPath: string, anchorDir: string, remoteRoot: string): string {
  if (!localPath) return remoteRoot

  const normLocal = posix.normalize(localPath.replace(/\\/g, '/'))
  const normAnchor = posix.normalize(anchorDir.replace(/\\/g, '/'))
  const cleanBase = posix.normalize(remoteRoot.replace(/\\/g, '/'))

  if (normLocal === normAnchor) {
    return cleanBase
  }

  let rel = ''
  const anchorWithSlash = normAnchor.endsWith('/') ? normAnchor : normAnchor + '/'

  if (normLocal.startsWith(anchorWithSlash)) {
    rel = normLocal.slice(anchorWithSlash.length)
  } else if (!normLocal.startsWith('/')) {
    rel = normLocal
  } else {
    rel = posix.relative(normAnchor, normLocal)
  }

  if (!rel || rel === '.') return cleanBase

  // Resolve target path against cleanBase
  const candidate = posix.resolve(cleanBase, rel)

  // Containment check: candidate must stay within cleanBase
  const baseWithSlash = cleanBase.endsWith('/') ? cleanBase : cleanBase + '/'
  const isWithin = candidate === cleanBase || candidate.startsWith(baseWithSlash)

  // If candidate escapes cleanBase, or relative path escapes via ../, reject immediately
  if (!isWithin || rel.startsWith('../') || rel === '..') {
    throw new Error(`路径遍历拦截：拒绝访问超出远程工作区的路径 "${localPath}"`)
  }

  return candidate
}

/**
 * Create a new remote workspace anchor and register it into DSH workspaceRegistry.
 * Passwords are retained as a compatibility parameter but are never cached here;
 * callers must verify them before creating the workspace.
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
    // Keep the legacy parameter for compatibility, but never cache an
    // unverified password from this workspace-construction helper.
    void password

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

function tryCleanWorkspaceConnection(anchorDir: string): void {
  try {
    const metaPath = join(anchorDir, '.remote-ssh.json')
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RemoteWorkspaceMeta
      if (meta && meta.host) {
        closeSshConnection(meta.host).catch(() => {})
      }
    }
  } catch {}
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
      tryCleanWorkspaceConnection(target)
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
  // Compare paths using their native spelling. Lowercasing would make a
  // case-sensitive path outside this directory look like an allowed anchor.
  const wsBaseDir = resolve(getWorkspacesDir())
  const prefixWithSep = wsBaseDir.endsWith(sep) ? wsBaseDir : wsBaseDir + sep

  reg.delete = async function (id: any) {
    let anchorToRemove: string | null = null
    try {
      const entity = typeof reg.get === 'function' ? reg.get(id) : null
      if (entity && entity.path) {
        const p = String(entity.path)
        const resolvedPath = resolve(p)
        let canon = resolvedPath
        try { canon = realpathSync(resolvedPath) } catch { }
        if (canon.startsWith(prefixWithSep) && canon !== wsBaseDir) {
          anchorToRemove = resolvedPath
        }
      }
    } catch { }

    const result = await originalDelete(id)

    if (anchorToRemove) {
      try {
        if (existsSync(anchorToRemove)) {
          tryCleanWorkspaceConnection(anchorToRemove)
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
const os = require('os');
const { spawn } = require('child_process');

function shellQuote(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "'\\\\''") + "'";
}

function parseSshConfigHosts() {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(configPath)) return new Set();
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split(/\\r?\\n/);
    const hosts = new Set();
    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf('#');
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
      if (!line) continue;
      const parts = line.split(/\\s+/);
      const key = parts[0] ? parts[0].toLowerCase() : '';
      if (key === 'host') {
        const aliases = parts.slice(1).filter((a) => a && !a.includes('*') && !a.includes('?') && !a.startsWith('-'));
        for (const a of aliases) hosts.add(a.toLowerCase());
      }
    }
    return hosts;
  } catch {
    return new Set();
  }
}

let meta = null;
try {
  const cur = process.cwd();
  const wsDir = path.resolve(path.join(os.homedir(), '.dsh', 'dsh-ssh', 'workspaces'));
  let canon = path.resolve(cur);
  try { canon = fs.realpathSync(canon); } catch {}

  const prefixWithSep = wsDir.endsWith(path.sep) ? wsDir : wsDir + path.sep;
  if (canon.startsWith(prefixWithSep) && canon !== wsDir) {
    const rel = path.relative(wsDir, canon);
    const anchorName = rel.split(path.sep)[0];
    if (anchorName && anchorName !== '.' && anchorName !== '..') {
      const anchorDir = path.join(wsDir, anchorName);
      const metaPath = path.join(anchorDir, '.remote-ssh.json');
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    }
  }
} catch {}

if (meta && meta.host && typeof meta.host === 'string') {
  const host = meta.host.trim();
  const validHosts = parseSshConfigHosts();
  if (!/^[a-zA-Z0-9_.-]+$/.test(host) || host.startsWith('-') || !validHosts.has(host.toLowerCase())) {
    console.error('[dsh-ssh] 非法或未在 ~/.ssh/config 中配置的 SSH 主机: ' + host);
    process.exit(1);
  }
  const remotePath = meta.remotePath;
  let remoteCmd = undefined;
  if (remotePath) {
    remoteCmd = 'cd ' + shellQuote(remotePath) + ' 2>/dev/null; exec \${SHELL:-/bin/bash} -l';
  }
  const socketPath = path.join(os.homedir(), '.dsh', 'dsh-ssh', 'sockets', '%r@%h:%p');
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
