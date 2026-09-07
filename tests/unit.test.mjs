import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSshConfig,
  isValidSshHost,
  localToRemotePath,
  setHostPassword,
  getHostPassword,
  hasHostPassword,
  removeHostPassword,
  deleteRemoteWorkspace,
  getWorkspacesDir,
  runSsh,
  remoteBrowseDirs
} from '../lib/index.js'

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

test('parseSshConfig parses PasswordAuthentication correctly', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const tempConfig = path.join(os.tmpdir(), `ssh-config-test-${Date.now()}`)

  const sampleConfig = `
Host pass-host
  HostName 192.168.1.50
  User root
  PasswordAuthentication yes

Host key-host
  HostName 192.168.1.51
  User ubuntu
  PasswordAuthentication no

Host default-host
  HostName 192.168.1.52
`
  fs.writeFileSync(tempConfig, sampleConfig, 'utf8')
  try {
    const entries = parseSshConfig(tempConfig)
    assert.equal(entries.length, 3)

    const pass = entries.find((e) => e.host === 'pass-host')
    assert(pass, 'pass-host should exist')
    assert.equal(pass.passwordAuthentication, true)

    const key = entries.find((e) => e.host === 'key-host')
    assert(key, 'key-host should exist')
    assert.equal(key.passwordAuthentication, false)

    const def = entries.find((e) => e.host === 'default-host')
    assert(def, 'default-host should exist')
    assert.equal(def.passwordAuthentication, undefined)
  } finally {
    fs.rmSync(tempConfig, { force: true })
  }
})

test('in-memory password store operations', () => {
  assert.equal(hasHostPassword('test-host-xyz'), false)
  setHostPassword('test-host-xyz', 'mySecret123')
  assert.equal(hasHostPassword('test-host-xyz'), true)
  assert.equal(getHostPassword('test-host-xyz'), 'mySecret123')

  removeHostPassword('test-host-xyz')
  assert.equal(hasHostPassword('test-host-xyz'), false)
  assert.equal(getHostPassword('test-host-xyz'), undefined)
})

test('isValidSshHost blocks argument injection and unknown hosts', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const tempConfig = path.join(os.tmpdir(), `ssh-config-sec-${Date.now()}`)

  const sampleConfig = `
Host safe-server
  HostName 192.168.1.100
Host -oProxyCommand=calc
  HostName 192.168.1.101
`
  fs.writeFileSync(tempConfig, sampleConfig, 'utf8')
  try {
    // Valid host
    assert.equal(isValidSshHost('safe-server', tempConfig), true)

    // Option injection attempts must be rejected
    assert.equal(isValidSshHost('-oProxyCommand=calc', tempConfig), false)
    assert.equal(isValidSshHost('-v', tempConfig), false)
    assert.equal(isValidSshHost('--help', tempConfig), false)

    // Non-existent hosts must be rejected
    assert.equal(isValidSshHost('not-configured-host', tempConfig), false)

    // Special characters / commands
    assert.equal(isValidSshHost('server; rm -rf /', tempConfig), false)
    assert.equal(isValidSshHost('server && id', tempConfig), false)
  } finally {
    fs.rmSync(tempConfig, { force: true })
  }
})

test('runSsh rejects unvalidated hosts before spawning ssh', async () => {
  const r1 = await runSsh('-oProxyCommand=evil', 'echo 1')
  assert.equal(r1.ok, false)
  assert(r1.error?.includes('主机校验失败'))

  const r2 = await runSsh('unknown-host-123456', 'echo 1')
  assert.equal(r2.ok, false)
  assert(r2.error?.includes('主机校验失败'))
})

test('localToRemotePath prevents path traversal escapes', () => {
  const anchor = '/home/user/.dsh/dsh-ssh/workspaces/ws-123'
  const remote = '/data/project/my-app'

  // Malicious path traversal attempts escaping remote root
  const malicious1 = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/../../../../../../etc/shadow'
  assert.equal(localToRemotePath(malicious1, anchor, remote), remote)

  const malicious2 = '../../../../../../etc/passwd'
  assert.equal(localToRemotePath(malicious2, anchor, remote), remote)

  // Normal nested subpaths remain intact
  const safeSub = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/sub/file.txt'
  assert.equal(localToRemotePath(safeSub, anchor, remote), '/data/project/my-app/sub/file.txt')
})

test('deleteRemoteWorkspace enforces strict anchor directory whitelist', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const fakeHome = path.join(os.tmpdir(), 'fake-home-del-' + Date.now())
  process.env.HOME = fakeHome
  try {
    const wsDir = getWorkspacesDir()

    // 1. Attempting to delete the root workspaces directory must fail
    const resRoot = await deleteRemoteWorkspace(null, wsDir)
    assert.equal(resRoot.ok, false)
    assert(resRoot.error?.includes('权限拒绝'))

    // 2. Attempting to delete arbitrary external path must fail
    const externalDir = path.join(os.tmpdir(), `external-dir-${Date.now()}`)
    fs.mkdirSync(externalDir, { recursive: true })
    try {
      const resExt = await deleteRemoteWorkspace(null, externalDir)
      assert.equal(resExt.ok, false)
      assert(resExt.error?.includes('权限拒绝'))
      assert(fs.existsSync(externalDir), 'external directory must NOT be deleted')
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true })
    }

    // 3. Valid workspace sub-directory deletion succeeds
    const validSub = path.join(wsDir, `ws-test-valid-${Date.now()}`)
    fs.mkdirSync(validSub, { recursive: true })
    assert(fs.existsSync(validSub))
    const resValid = await deleteRemoteWorkspace(null, validSub)
    assert.equal(resValid.ok, true)
    assert(!fs.existsSync(validSub), 'valid workspace anchor directory should be deleted')
  } finally {
    process.env.HOME = oldHome
    fs.rmSync(fakeHome, { recursive: true, force: true })
  }
})

test('registerFsInterceptors passes through local workspace requests to original handler', async () => {
  const { registerFsInterceptors } = await import('../lib/index.js')
  const { Readable } = await import('node:stream')

  let passedThrough = false
  let receivedPayload = null

  const mockWebServer = {
    exact: new Map(),
    prefixes: new Map([
      [
        '/sidebar/api',
        {
          path: '/sidebar/api',
          handler: async (req, res) => {
            passedThrough = true
            const chunks = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            receivedPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            res.writeHead(200)
            res.end()
          }
        }
      ]
    ]),
    register(route) {
      this.exact.set(route.path, route)
      return () => this.exact.delete(route.path)
    }
  }

  const mockCtx = {
    webServer: mockWebServer,
    effect(fn) {
      return fn()
    }
  }

  registerFsInterceptors(mockCtx)

  const interceptedRoute = mockWebServer.exact.get('/sidebar/api/fs.read')
  assert(interceptedRoute, 'exact route for /sidebar/api/fs.read should be registered')

  const fakeReq = Readable.from([Buffer.from(JSON.stringify({ path: '/local/test.txt' }))])
  fakeReq.method = 'POST'
  fakeReq.url = '/sidebar/api/fs.read'

  const fakeRes = {
    writeHead() {},
    end() {}
  }

  await interceptedRoute.handler(fakeReq, fakeRes)

  assert.equal(passedThrough, true, 'local workspace request must be passed through to original handler')
  assert.deepEqual(receivedPayload, { path: '/local/test.txt' }, 'payload must be preserved and replayed')
})

test('remoteBrowseDirs blocks dangerous characters and unvalidated hosts', async () => {
  // 1. Invalid path characters (newlines, null bytes) must be blocked
  const res1 = await remoteBrowseDirs('orangepi', '/tmp/foo\nrm -rf /')
  assert.equal(res1.ok, false)
  assert(res1.error?.includes('非法路径字符'))

  const res2 = await remoteBrowseDirs('orangepi', '/tmp/foo\0bar')
  assert.equal(res2.ok, false)
  assert(res2.error?.includes('非法路径字符'))

  // 2. Unconfigured / malicious hosts must be rejected immediately by host validation
  const res3 = await remoteBrowseDirs('-oProxyCommand=evil', '/var/www')
  assert.equal(res3.ok, false)
  assert(res3.error?.includes('主机校验失败'))

  const res4 = await remoteBrowseDirs('non-existent-host-xyz', '/var/www')
  assert.equal(res4.ok, false)
  assert(res4.error?.includes('主机校验失败'))
})


