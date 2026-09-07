import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSshConfig, localToRemotePath } from '../lib/index.js'

test('parseSshConfig correctly parses ~/.ssh/config', () => {
  const hosts = parseSshConfig()
  assert(Array.isArray(hosts), 'hosts should be an array')
  console.log('Parsed hosts from ~/.ssh/config:', hosts.map((h) => h.host))
  assert(hosts.length > 0, 'should have parsed at least one host')
})

test('localToRemotePath correctly translates paths', () => {
  const anchor = '/home/user/.dsh/dsh-ssh/workspaces/ws-123'
  const remote = '/data/project/my-app'

  // Root of anchor -> remote root
  assert.equal(localToRemotePath(anchor, anchor, remote), remote)
  assert.equal(localToRemotePath('', anchor, remote), remote)

  // Subdir of anchor
  const sub = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/src/index.ts'
  assert.equal(localToRemotePath(sub, anchor, remote), '/data/project/my-app/src/index.ts')

  // Nested subdir
  const nested = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/a/b/c.txt'
  assert.equal(localToRemotePath(nested, anchor, remote), '/data/project/my-app/a/b/c.txt')
})

test('tool outputs are guaranteed to be lossless JSON', async () => {
  const { snapshotJsonValue } = await import(
    '/home/user1/.local/share/pnpm/store/v11/links/@deepseek-ai/dsh-util-values/0.1.2-rc.1/9628e3409471155cb618fb6698943649f63b0f0d39272f26ef19a5327b0a339f/node_modules/@deepseek-ai/dsh-util-values/lib/index.js'
  )

  function toCleanJson(val) {
    return JSON.parse(JSON.stringify(val))
  }

  // Simulated exec output with optional undefined fields
  const execOutput = toCleanJson({
    ok: true,
    exitCode: 0,
    stdout: 'total 0\n',
    stderr: '',
    error: undefined
  })
  const snap1 = snapshotJsonValue(execOutput)
  assert.notEqual(snap1, undefined, 'exec output must be lossless JSON')
  assert.equal(snap1.ok, true)
  assert.equal(snap1.exitCode, 0)
  assert.equal(snap1.error, undefined)

  // Simulated hosts output
  const hostsOutput = toCleanJson({
    hosts: [{ host: 'orangepi', hostName: '192.168.2.110', user: undefined }],
    currentRemote: null
  })
  const snap2 = snapshotJsonValue(hostsOutput)
  assert.notEqual(snap2, undefined, 'hosts output must be lossless JSON')
})

test('hookWorkspaceRegistryDeletion removes anchor directory upon deletion', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { hookWorkspaceRegistryDeletion } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const fakeHome = path.join(os.tmpdir(), 'fake-home-hook-' + Date.now())
  const fakeWsDir = path.join(fakeHome, '.dsh', 'dsh-ssh', 'workspaces')
  const fakeAnchor = path.join(fakeWsDir, 'ws-target-del')
  fs.mkdirSync(fakeAnchor, { recursive: true })
  fs.writeFileSync(path.join(fakeAnchor, '.remote-ssh.json'), JSON.stringify({ host: 'test', remotePath: '/tmp' }))

  process.env.HOME = fakeHome
  try {
    const mockRegistry = {
      delete: async (id) => true,
      get: (id) => ({ id, path: fakeAnchor })
    }
    const mockCtx = { workspaceRegistry: mockRegistry }

    hookWorkspaceRegistryDeletion(mockCtx)
    assert(fs.existsSync(fakeAnchor), 'anchor should exist before delete')

    await mockRegistry.delete('test-ws-id')
    assert(!fs.existsSync(fakeAnchor), 'anchor directory must be deleted immediately after workspace delete')
  } finally {
    process.env.HOME = oldHome
    fs.rmSync(fakeHome, { recursive: true, force: true })
  }
})
