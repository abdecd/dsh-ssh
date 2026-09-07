#!/usr/bin/env node
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wrapClient } from './wrap-client.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const tmpDir = join(root, '.tmp')
const libDir = join(root, 'lib')

mkdirSync(tmpDir, { recursive: true })
mkdirSync(libDir, { recursive: true })

console.log('[build] Compiling Host bundle (src/index.ts -> lib/index.js)...')
await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(libDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info'
})

const clientEntry = join(root, 'src/client/index.tsx')
if (existsSync(clientEntry) || existsSync(join(root, 'src/client/index.ts'))) {
  const actualEntry = existsSync(clientEntry) ? clientEntry : join(root, 'src/client/index.ts')
  console.log('[build] Compiling Client bundle (' + actualEntry + ' -> lib/client.js)...')
  const clientCjs = join(tmpDir, 'client.cjs')
  await build({
    entryPoints: [actualEntry],
    outfile: clientCjs,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'transform',
    external: ['react', 'react-dom'],
    sourcemap: false,
    logLevel: 'info'
  })
  wrapClient(clientCjs, join(libDir, 'client.js'))
}

console.log('[build] Emitting TypeScript types...')
try {
  execFileSync('npx', ['tsc', '--emitDeclarationOnly'], { cwd: root, stdio: 'inherit' })
} catch (e) {
  console.warn('[build] Type declaration emit warning (will proceed):', e?.message)
}

rmSync(tmpDir, { recursive: true, force: true })
console.log('[build] Done: lib/index.js, lib/client.js, lib/index.d.ts')
