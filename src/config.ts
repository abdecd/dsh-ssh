import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface SshHostEntry {
  host: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}

/**
 * Parse ~/.ssh/config and extract valid Host entries.
 * Skips wildcard entries (*, ?).
 */
export function parseSshConfig(): SshHostEntry[] {
  const configPath = join(homedir(), '.ssh', 'config')
  if (!existsSync(configPath)) {
    return []
  }

  try {
    const content = readFileSync(configPath, 'utf8')
    const lines = content.split(/\r?\n/)
    const hosts: SshHostEntry[] = []
    let current: SshHostEntry | null = null

    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf('#')
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim()
      if (!line) continue

      const parts = line.split(/\s+/)
      const key = parts[0]?.toLowerCase()
      const value = parts.slice(1).join(' ').trim()

      if (key === 'host') {
        const aliases = parts.slice(1).filter((a) => a && !a.includes('*') && !a.includes('?'))
        for (const alias of aliases) {
          current = { host: alias }
          hosts.push(current)
        }
      } else if (current) {
        if (key === 'hostname') current.hostName = value
        else if (key === 'user') current.user = value
        else if (key === 'port') current.port = parseInt(value, 10) || 22
        else if (key === 'identityfile') current.identityFile = value.replace(/^~(?=$|\/|\\)/, homedir())
        else if (key === 'proxyjump') current.proxyJump = value
      }
    }

    return hosts
  } catch (err) {
    console.error('[dsh-ssh] Failed to read ~/.ssh/config:', err)
    return []
  }
}
