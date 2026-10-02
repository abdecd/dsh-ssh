import { homedir } from 'node:os'
import { join } from 'node:path'
import { findRemoteWorkspaceMeta } from './workspace'

/**
 * DSH's native terminal controller delegates terminal creation to the scoped
 * subprocess provider. Wrap that one operation only; ordinary subprocesses and
 * terminals outside managed remote anchors retain their original behavior.
 */
export function hookNativeTerminals(ctx: any): () => void {
  const wrapped = new WeakMap<object, { original: Function; wrapper: Function }>()
  const providers = new Set<any>()

  const install = (provider: any) => {
    if (!provider || typeof provider.spawnTerminal !== 'function' || wrapped.has(provider)) return
    const original = provider.spawnTerminal
    const wrapper = function (this: any, spec: any) {
      const info = typeof spec?.cwd === 'string' ? findRemoteWorkspaceMeta(spec.cwd) : null
      if (!info) return original.call(this, spec)
      // Interactive password prompts are handled by SSH in the PTY; unlike
      // noninteractive file requests, no password is copied into argv/env.
      const runner = join(homedir(), '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')
      return original.call(this, { ...spec, argv: [process.execPath, runner], shellActivity: false })
    }
    provider.spawnTerminal = wrapper
    wrapped.set(provider, { original, wrapper })
    providers.add(provider)
  }

  // Resolve through the agent scope: execution providers can differ per Agent.
  const installAgent = (agent: any) => {
    try { install(agent?.ctx?.get?.('subprocess')) } catch { /* provider not ready */ }
  }
  try { install(ctx.get?.('subprocess')) } catch { /* optional */ }
  try { for (const agent of ctx.agents?.list?.() || []) installAgent(agent) } catch {}
  const stopCreated = ctx.on?.('agent/created', ({ agent }: any) => installAgent(agent))
  const stopSubprocess = ctx.inject?.(['subprocess'], (scoped: any) => {
    install(scoped.subprocess)
  })
  const stopAgents = ctx.inject?.(['agents'], (scoped: any) => {
    for (const agent of scoped.agents?.list?.() || []) installAgent(agent)
  })

  const cleanup = () => {
    stopCreated?.()
    stopSubprocess?.()
    stopAgents?.()
    for (const provider of providers) {
      const entry = wrapped.get(provider)
      if (entry && provider.spawnTerminal === entry.wrapper) provider.spawnTerminal = entry.original
    }
    providers.clear()
  }
  ctx.effect?.(() => cleanup, 'dsh-ssh: native terminal hook')
  return cleanup
}
