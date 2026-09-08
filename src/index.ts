import { Context } from '@deepseek-ai/cordis'
import { ensureShellWrapper, hookWorkspaceRegistryDeletion } from './workspace'
import { registerFsInterceptors } from './interceptor'
import { setupRemoteTools } from './tools'
import { registerApiRoutes } from './api'

export const name = 'dsh-ssh'
export const inject = ['webServer', 'tools', 'workspaceRegistry']

export * from './config'
export * from './workspace'
export * from './connection'
export * from './interceptor'
export * from './tools'

export function apply(ctx: Context) {
  // 1. Ensure the terminal shell wrapper is generated in ~/.dsh/dsh-ssh/
  ensureShellWrapper()

  // 2. Hook workspaceRegistry deletion so removing a workspace in DSH
  // immediately deletes its corresponding anchor directory in ~/.dsh/dsh-ssh/workspaces/
  hookWorkspaceRegistryDeletion(ctx)

  // 3. Register exact routes to intercept /sidebar/api/fs.* for dsh-better-sidebar
  registerFsInterceptors(ctx)

  // 4. Register concise AI tools only for remote workspace sessions: remote_ssh_exec, remote_ssh_read, etc.
  setupRemoteTools(ctx)

  // 5. Register HTTP JSON API for web client (/dsh-ssh/api)
  registerApiRoutes(ctx)

  ctx.logger?.info('[dsh-ssh] Concise Remote-SSH plugin loaded successfully.')
}

export default {
  name,
  inject,
  apply
}
