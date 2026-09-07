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
  passwordAuthentication?: boolean
}

/**
 * Parse ~/.ssh/config and extract valid Host entries.
 * Skips wildcard entries (*, ?).
 */
export function parseSshConfig(customPath?: string): SshHostEntry[] {
  const configPath = customPath || join(homedir(), '.ssh', 'config')
  if (!existsSync(configPath)) {
    return []
  }

  try {
    const content = readFileSync(configPath, 'utf8')
    const lines = content.split(/\r?\n/)
    const hosts: SshHostEntry[] = []
    let currentEntries: SshHostEntry[] = []

    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf('#')
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim()
      if (!line) continue

      const parts = line.split(/\s+/)
      const key = parts[0]?.toLowerCase()
      const value = parts.slice(1).join(' ').trim()

      if (key === 'host') {
        const aliases = parts.slice(1).filter((a) => a && !a.includes('*') && !a.includes('?') && !a.startsWith('-'))
        currentEntries = []
        for (const alias of aliases) {
          const entry: SshHostEntry = { host: alias }
          currentEntries.push(entry)
          hosts.push(entry)
        }
      } else if (currentEntries.length > 0) {
        for (const current of currentEntries) {
          if (key === 'hostname') current.hostName = value
          else if (key === 'user') current.user = value
          else if (key === 'port') current.port = parseInt(value, 10) || 22
          else if (key === 'identityfile') current.identityFile = value.replace(/^~(?=$|\/|\\)/, homedir())
          else if (key === 'proxyjump') current.proxyJump = value
          else if (key === 'passwordauthentication') {
            current.passwordAuthentication = value.toLowerCase() === 'yes'
          }
        }
      }
    }

    return hosts
  } catch (err) {
    console.error('[dsh-ssh] Failed to read ~/.ssh/config:', err)
    return []
  }
}

/**
 * Validate that a host string is a safe, RFC-compliant hostname
 * and is present in ~/.ssh/config.
 */
export function isValidSshHost(host: string, customPath?: string): boolean {
  if (!host || typeof host !== 'string') return false
  const clean = host.trim()
  if (!clean || clean.startsWith('-') || !/^[a-zA-Z0-9_.-]+$/.test(clean)) {
    return false
  }
  const validHosts = parseSshConfig(customPath)
  return validHosts.some((h) => h.host.toLowerCase() === clean.toLowerCase())
}

