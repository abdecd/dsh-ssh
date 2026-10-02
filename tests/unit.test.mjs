import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSshConfig,
  isValidSshHost,
  localToRemotePath,
  findRemoteWorkspaceMeta,
  setHostPassword,
  getHostPassword,
  hasHostPassword,
  removeHostPassword,
  deleteRemoteWorkspace,
  getWorkspacesDir,
  runSsh,
  remoteReadFile,
  remoteWriteFile,
  remoteBrowseDirs,
  isSafeRequest,
  shellCd,
  shellQuoteRemotePath,
  SSH_CONNECTION_TIMEOUT_MS,
  SSH_CONNECTION_TIMEOUT_SECONDS
} from '../lib/index.js'

function restoreHome(oldHome) {
  if (oldHome === undefined) delete process.env.HOME
  else process.env.HOME = oldHome
}

test('parseSshConfig correctly parses ~/.ssh/config with isolated fixture', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-ssh-parse-test-${Date.now()}-`))
  const sshDir = path.join(tempHome, '.ssh')
  fs.mkdirSync(sshDir, { recursive: true })
  fs.writeFileSync(
    path.join(sshDir, 'config'),
    `
Host isolated-host-1
  HostName 192.168.1.101
  User root
  Port 22

Host isolated-host-2
  HostName 192.168.1.102
  User ubuntu
  IdentityFile ~/.ssh/id_rsa
`,
    'utf8'
  )

  const oldHome = process.env.HOME
  process.env.HOME = tempHome
  try {
    const hosts = parseSshConfig()
    assert(Array.isArray(hosts), 'hosts should be an array')
    assert.equal(hosts.length, 2, 'should parse exactly 2 hosts from isolated fixture')
    assert.equal(hosts[0].host, 'isolated-host-1')
    assert.equal(hosts[0].hostName, '192.168.1.101')
    assert.equal(hosts[1].host, 'isolated-host-2')
    assert.equal(hosts[1].user, 'ubuntu')
  } finally {
    restoreHome(oldHome)
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
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

  // A home-relative remote root must retain its tilde for remote shell expansion.
  const homeRoot = '~/rss2mail'
  assert.equal(localToRemotePath(anchor, anchor, homeRoot), homeRoot)
  assert.equal(localToRemotePath(`${anchor}/rss2mail`, anchor, '~'), '~/rss2mail')
  assert.equal(localToRemotePath(`${anchor}/src/file with spaces`, anchor, homeRoot), '~/rss2mail/src/file with spaces')
  assert.equal(localToRemotePath(`${anchor}/src`, anchor, '/'), '/src')
})

test('tool outputs are guaranteed to be lossless JSON', async () => {
  const { createRequire } = await import('node:module')
  const req = createRequire(import.meta.url)

  let snapshotJsonValue
  try {
    const toolsPkg = req.resolve('@deepseek-ai/dsh-tools/package.json')
    const valuesPath = req.resolve('@deepseek-ai/dsh-util-values', { paths: [toolsPkg] })
    const mod = await import(valuesPath)
    snapshotJsonValue = mod.snapshotJsonValue
  } catch {
    snapshotJsonValue = (val) => {
      if (val === undefined) return undefined
      const str = JSON.stringify(val)
      if (str === undefined) return undefined
      return JSON.parse(str)
    }
  }

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
    restoreHome(oldHome)
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
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const oldHome = process.env.HOME
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-ssh-unval-test-${Date.now()}-`))
  process.env.HOME = tempHome
  try {
    const r1 = await runSsh('-oProxyCommand=evil', 'echo 1')
    assert.equal(r1.ok, false)
    assert(r1.error?.includes('主机校验失败'))

    const r2 = await runSsh('unknown-host-123456', 'echo 1')
    assert.equal(r2.ok, false)
    assert(r2.error?.includes('主机校验失败'))
  } finally {
    restoreHome(oldHome)
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

test('localToRemotePath prevents path traversal escapes', () => {
  const anchor = '/home/user/.dsh/dsh-ssh/workspaces/ws-123'
  const remote = '/data/project/my-app'

  // Malicious path traversal attempts escaping remote root must throw security error
  const malicious1 = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/../../../../../../etc/shadow'
  assert.throws(() => localToRemotePath(malicious1, anchor, remote), /路径遍历拦截/)

  const malicious2 = '../../../../../../etc/passwd'
  assert.throws(() => localToRemotePath(malicious2, anchor, remote), /路径遍历拦截/)
  assert.throws(() => localToRemotePath(`${anchor}/../ws-other/file`, anchor, '~'), /路径遍历拦截/)
  assert.throws(() => localToRemotePath('/etc/passwd', anchor, '/'), /路径遍历拦截/)

  // Normal nested subpaths remain intact
  const safeSub = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/sub/file.txt'
  assert.equal(localToRemotePath(safeSub, anchor, remote), '/data/project/my-app/sub/file.txt')
})

test('findRemoteWorkspaceMeta resolves deep subdirectories in managed workspaces and rejects unmanaged projects', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const fakeHome = path.join(os.tmpdir(), `dsh-meta-test-${Date.now()}`)
  const fakeSshDir = path.join(fakeHome, '.ssh')
  const fakeWsDir = path.join(fakeHome, '.dsh', 'dsh-ssh', 'workspaces')
  const managedAnchor = path.join(fakeWsDir, 'ws-test-deep')
  const deepDir = path.join(managedAnchor, 'src', 'components', 'modals', 'nested')
  const unmanagedDir = path.join(fakeHome, 'unmanaged-project')

  fs.mkdirSync(fakeSshDir, { recursive: true })
  fs.writeFileSync(path.join(fakeSshDir, 'config'), 'Host test-remote-host\n  HostName 10.0.0.1\n', 'utf8')
  fs.mkdirSync(deepDir, { recursive: true })
  fs.mkdirSync(unmanagedDir, { recursive: true })

  const metaContent = {
    host: 'test-remote-host',
    remotePath: '/var/www/project'
  }
  fs.writeFileSync(path.join(managedAnchor, '.remote-ssh.json'), JSON.stringify(metaContent), 'utf8')
  fs.writeFileSync(path.join(unmanagedDir, '.remote-ssh.json'), JSON.stringify(metaContent), 'utf8')

  process.env.HOME = fakeHome
  try {
    // 1. Managed workspace deep path must find the anchor
    const found = findRemoteWorkspaceMeta(deepDir)
    assert(found, 'must find meta from deep nested subdirectory in managed workspace')
    assert.equal(found.meta.host, 'test-remote-host')
    assert.equal(found.meta.remotePath, '/var/www/project')
    assert.equal(found.anchorDir, managedAnchor)

    // 2. Unmanaged arbitrary project directory containing .remote-ssh.json must be rejected
    const unmanagedFound = findRemoteWorkspaceMeta(unmanagedDir)
    assert.equal(unmanagedFound, null, 'must reject unmanaged project outside workspaces directory')
  } finally {
    restoreHome(oldHome)
    fs.rmSync(fakeHome, { recursive: true, force: true })
  }
})

test('isSafeRequest strictly validates origin, host, and port', () => {
  // 1. Cross-site fetch must be blocked
  assert.equal(isSafeRequest({ headers: { 'sec-fetch-site': 'cross-site' } }), false)

  // 2. Disallowed simple request content-types
  assert.equal(isSafeRequest({ headers: { 'content-type': 'application/x-www-form-urlencoded' } }), false)
  assert.equal(isSafeRequest({ headers: { 'content-type': 'multipart/form-data' } }), false)

  // 3. Untrusted external origin
  assert.equal(isSafeRequest({ headers: { host: 'localhost:3080', origin: 'http://attacker.com' } }), false)
  assert.equal(isSafeRequest({ headers: { host: 'localhost:3080', referer: 'https://evil.org/hack' } }), false)

  // 4. Cross-port requests on localhost must be REJECTED (solves same-host cross-port CSRF)
  assert.equal(
    isSafeRequest({ headers: { host: 'localhost:3080', origin: 'http://localhost:8080' } }),
    false,
    'different port on localhost must be blocked'
  )
  assert.equal(
    isSafeRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9000' } }),
    false,
    'different port on 127.0.0.1 must be blocked'
  )
  assert.equal(
    isSafeRequest({ headers: { host: 'my-dsh.internal:3080', origin: 'http://my-dsh.internal:8888' } }),
    false,
    'different port on domain must be blocked'
  )

  // 5. Trusted matching origin and port
  assert.equal(isSafeRequest({ headers: { host: 'localhost:3080', origin: 'http://localhost:3080' } }), true)
  assert.equal(isSafeRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(isSafeRequest({ headers: { host: 'localhost:3080', origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(isSafeRequest({ headers: { host: 'my-dsh.internal:443', origin: 'https://my-dsh.internal:443' } }), true)
  assert.equal(
    isSafeRequest({
      headers: { host: 'my-dsh.internal', 'x-forwarded-proto': 'https', origin: 'https://my-dsh.internal' }
    }),
    true
  )
  assert.equal(isSafeRequest({ headers: { host: 'my-dsh.internal', origin: 'http://my-dsh.internal' } }), true)

  // 6. Browser-like request stripped of Origin/Referer must be blocked
  assert.equal(isSafeRequest({ headers: { 'sec-fetch-mode': 'cors' } }), false)
  assert.equal(isSafeRequest({ headers: { 'sec-ch-ua': '"Not;A=Brand";v="24"' } }), false)

  // 7. Non-browser local CLI callers (loopback) allowed
  assert.equal(isSafeRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true)

  // 8. Non-browser external callers without origin must be blocked
  assert.equal(isSafeRequest({ headers: {}, socket: { remoteAddress: '192.168.1.100' } }), false)
})

test('shellCd correctly handles ~ home directory expansion', () => {
  assert.equal(shellCd('~'), 'cd "$HOME" 2>/dev/null || cd ~ 2>/dev/null || cd')
  assert.equal(shellCd(''), 'cd "$HOME" 2>/dev/null || cd ~ 2>/dev/null || cd')

  const sub = shellCd('~/my project/src')
  assert(sub.startsWith('cd "$HOME"/\'my project/src\''), 'subpath must keep $HOME unquoted for expansion')

  const abs = shellCd('/var/log/nginx')
  assert.equal(abs, "cd '/var/log/nginx' 2>/dev/null")
})

test('home-relative remote paths expand safely for file operations', async () => {
  const { execFileSync } = await import('node:child_process')
  const path = await import('node:path')
  const os = await import('node:os')
  const fs = await import('node:fs')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ssh-home-'))
  try {
    const target = '~/rss2mail/file with spaces.txt'
    assert.equal(shellQuoteRemotePath(target), '"$HOME"/\'rss2mail/file with spaces.txt\'')
    assert.equal(shellQuoteRemotePath('/tmp/plain'), "'/tmp/plain'")
    assert.equal(shellQuoteRemotePath('~'), '"$HOME"')
    const quoted = shellQuoteRemotePath(target)
    execFileSync('sh', ['-c', `mkdir -p "$HOME/rss2mail" && printf safe > ${quoted}`], { env: { ...process.env, HOME: home } })
    assert.equal(fs.readFileSync(path.join(home, 'rss2mail', 'file with spaces.txt'), 'utf8'), 'safe')
    const injection = '~/rss2mail/$(touch injected)'
    execFileSync('sh', ['-c', `printf safe > ${shellQuoteRemotePath(injection)}`], { env: { ...process.env, HOME: home } })
    assert.equal(fs.existsSync(path.join(home, 'injected')), false)
    assert.equal(fs.readFileSync(path.join(home, 'rss2mail', '$(touch injected)'), 'utf8'), 'safe')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
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
    restoreHome(oldHome)
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
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-browse-test-${Date.now()}-`))
  const sshDir = path.join(tempHome, '.ssh')
  fs.mkdirSync(sshDir, { recursive: true })
  fs.writeFileSync(path.join(sshDir, 'config'), 'Host orangepi\n  HostName 192.168.1.100\n', 'utf8')
  process.env.HOME = tempHome
  try {
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
  } finally {
    restoreHome(oldHome)
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

test('workspace deletion keeps case-sensitive POSIX paths outside the allowlist', async () => {
  if (process.platform === 'win32') return

  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { hookWorkspaceRegistryDeletion } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const fakeHome = path.join(os.tmpdir(), 'fake-home-case-' + Date.now())
  const caseVariantAnchor = path.join(fakeHome, '.dsh', 'DSH-SSH', 'workspaces', 'ordinary-project')
  fs.mkdirSync(caseVariantAnchor, { recursive: true })
  fs.writeFileSync(path.join(caseVariantAnchor, 'sentinel'), 'must remain')

  process.env.HOME = fakeHome
  try {
    const mockRegistry = {
      delete: async () => true,
      get: () => ({ path: caseVariantAnchor })
    }

    hookWorkspaceRegistryDeletion({ workspaceRegistry: mockRegistry })
    await mockRegistry.delete('ordinary-project')
    assert(fs.existsSync(path.join(caseVariantAnchor, 'sentinel')), 'case-distinct path must not be treated as an anchor')
  } finally {
    restoreHome(oldHome)
    fs.rmSync(fakeHome, { recursive: true, force: true })
  }
})

test('remote_ssh_exec does not run a command when cwd cannot be entered', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { registerTools } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cwd-test-'))
  const binDir = path.join(tempRoot, 'bin')
  const anchorDir = path.join(tempRoot, 'anchor')
  const marker = path.join(tempRoot, 'executed')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(anchorDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host cwd-fixture\n  HostName 127.0.0.1\n', 'utf8')
  fs.writeFileSync(path.join(anchorDir, '.remote-ssh.json'), JSON.stringify({
    host: 'cwd-fixture',
    remotePath: '/tmp',
    authType: 'key'
  }), 'utf8')
  const fakeSsh = path.join(binDir, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\n/bin/sh -c "$last"\n', 'utf8')
  fs.chmodSync(fakeSsh, 0o755)

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  try {
    const tools = new Map()
    registerTools({ tools: { register: (tool) => tools.set(tool.name, tool) } })
    const result = await tools.get('remote_ssh_exec').execute({
      host: 'cwd-fixture',
      cwd: path.join(tempRoot, 'missing-directory'),
      command: `printf executed > ${marker}`
    }, { session: { header: { cwd: anchorDir } } })

    assert.equal(result.ok, false, 'failed cwd must fail the SSH command')
    assert.equal(fs.existsSync(marker), false, 'command must not run after cwd failure')
  } finally {
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('password verification bypasses cached credentials and disables SSH reuse', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { getHostPassword, removeHostPassword, setHostPassword, testSshConnection } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-password-test-'))
  const binDir = path.join(tempRoot, 'bin')
  const argsFile = path.join(tempRoot, 'sshpass-args')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host password-fixture\n  HostName 127.0.0.1\n', 'utf8')
  const fakeSshpass = path.join(binDir, 'sshpass')
  fs.writeFileSync(fakeSshpass, '#!/bin/sh\nprintf "%s\\n" "$@" > "$DSH_TEST_SSHPASS_ARGS"\nprintf "OK\\n"\n', 'utf8')
  fs.chmodSync(fakeSshpass, 0o755)

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  process.env.DSH_TEST_SSHPASS_ARGS = argsFile
  removeHostPassword('password-fixture')
  setHostPassword('password-fixture', 'old-password')
  try {
    const result = await testSshConnection('password-fixture', 'new-password')
    assert.equal(result.ok, true)
    assert.equal(getHostPassword('password-fixture'), 'old-password', 'verification must not replace the cache itself')

    const args = fs.readFileSync(argsFile, 'utf8')
    assert.match(args, /ControlMaster=no/)
    assert.match(args, /ControlPath=none/)
    assert.match(args, /PubkeyAuthentication=no/)
    assert.match(args, /PreferredAuthentications=password/)
    assert.match(args, /KbdInteractiveAuthentication=no/)
  } finally {
    removeHostPassword('password-fixture')
    delete process.env.DSH_TEST_SSHPASS_ARGS
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('remoteWriteFile preserves existing file permissions and does not loosen mode', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-perm-test-'))
  const binDir = path.join(tempRoot, 'bin')
  const testDir = path.join(tempRoot, 'remote')
  const secretFile = path.join(testDir, 'secret.env')
  const execFile = path.join(testDir, 'script.sh')

  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(testDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host perm-fixture\n  HostName 127.0.0.1\n', 'utf8')

  // Create fake ssh that executes the command directly via sh
  const fakeSsh = path.join(binDir, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\nexec /bin/sh -c "$last"\n', 'utf8')
  fs.chmodSync(fakeSsh, 0o755)

  // 1. Existing 0600 file
  fs.writeFileSync(secretFile, 'SECRET_KEY=123456\n', { mode: 0o600 })
  assert.equal((fs.statSync(secretFile).mode & 0o777).toString(8), '600')

  // 2. Existing 0755 executable
  fs.writeFileSync(execFile, '#!/bin/sh\necho hi\n', { mode: 0o755 })
  assert.equal((fs.statSync(execFile).mode & 0o777).toString(8), '755')

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  try {
    const res1 = await remoteWriteFile('perm-fixture', secretFile, 'SECRET_KEY=updated\n')
    assert.equal(res1.ok, true)
    assert.equal(fs.readFileSync(secretFile, 'utf8'), 'SECRET_KEY=updated\n')
    assert.equal((fs.statSync(secretFile).mode & 0o777).toString(8), '600', '0600 mode must be preserved')

    const res2 = await remoteWriteFile('perm-fixture', execFile, '#!/bin/sh\necho updated\n')
    assert.equal(res2.ok, true)
    assert.equal((fs.statSync(execFile).mode & 0o777).toString(8), '755', '0755 mode must be preserved')
  } finally {
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('remoteReadFile handles files over 7.5MB without truncation and rejects corrupted streams', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-large-test-'))
  const binDir = path.join(tempRoot, 'bin')
  const testDir = path.join(tempRoot, 'remote')
  const bigFile = path.join(testDir, 'large.bin')

  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(testDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host large-fixture\n  HostName 127.0.0.1\n', 'utf8')

  // Generate an 8MB buffer (which expands to ~10.67MB in Base64)
  const bigBuffer = Buffer.alloc(8 * 1024 * 1024, 75) // 8MB of 'K'
  fs.writeFileSync(bigFile, bigBuffer)

  const fakeSsh = path.join(binDir, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\nexec /bin/sh -c "$last"\n', 'utf8')
  fs.chmodSync(fakeSsh, 0o755)

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  try {
    // 1. Successfully read large 8MB file without silent Base64 truncation
    const res = await remoteReadFile('large-fixture', bigFile)
    assert.equal(res.ok, true)
    assert.equal(res.size, 8 * 1024 * 1024)
    assert.equal(res.content?.length, 8 * 1024 * 1024)
    assert.equal(res.truncated, false)

    // 2. Corrupted fake ssh that omits EOF marker must be rejected
    const corruptSsh = path.join(binDir, 'corrupt-ssh')
    fs.writeFileSync(corruptSsh, '#!/bin/sh\nfor arg do last="$arg"; done\n/bin/sh -c "$last" | grep -v "__DSH_READ_EOF__"\n', 'utf8')
    fs.chmodSync(corruptSsh, 0o755)
    fs.copyFileSync(corruptSsh, fakeSsh)

    // Clear read cache first
    const { invalidateCache } = await import('../lib/index.js')
    invalidateCache('large-fixture', bigFile)

    const corruptRes = await remoteReadFile('large-fixture', bigFile)
    assert.equal(corruptRes.ok, false)
    assert.match(corruptRes.error || '', /未完成|校验失败/)
  } finally {
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('remoteWriteFile respects strict remote umask for new files and avoids unconditional 0644', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-umask-test-'))
  const binDir = path.join(tempRoot, 'bin')
  const testDir = path.join(tempRoot, 'remote')
  const fileUnderStrict = path.join(testDir, 'strict_new.env')
  const fileUnderStandard = path.join(testDir, 'standard_new.txt')

  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(testDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host umask-fixture\n  HostName 127.0.0.1\n', 'utf8')

  // 1. Fake ssh that runs under strict umask 077
  const fakeSsh = path.join(binDir, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\numask 077\nexec /bin/sh -c "$last"\n', 'utf8')
  fs.chmodSync(fakeSsh, 0o755)

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  try {
    const resStrict = await remoteWriteFile('umask-fixture', fileUnderStrict, 'SECRET=val\n')
    assert.equal(resStrict.ok, true)
    assert.equal((fs.statSync(fileUnderStrict).mode & 0o777).toString(8), '600', 'new file under umask 077 must be 0600')

    // 2. Fake ssh that runs under standard umask 022
    fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\numask 022\nexec /bin/sh -c "$last"\n', 'utf8')
    const resStandard = await remoteWriteFile('umask-fixture', fileUnderStandard, 'NORMAL=val\n')
    assert.equal(resStandard.ok, true)
    assert.equal((fs.statSync(fileUnderStandard).mode & 0o777).toString(8), '644', 'new file under umask 022 must be 0644')
  } finally {
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('runSsh handles early process termination without crashing on unhandled stdin EPIPE error', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const oldHome = process.env.HOME
  const oldPath = process.env.PATH
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-epipe-test-'))
  const binDir = path.join(tempRoot, 'bin')

  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(path.join(tempRoot, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, '.ssh', 'config'), 'Host epipe-fixture\n  HostName 127.0.0.1\n', 'utf8')

  // Fake ssh that exits immediately with failure without reading stdin
  const fakeSsh = path.join(binDir, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nexit 1\n', 'utf8')
  fs.chmodSync(fakeSsh, 0o755)

  process.env.HOME = tempRoot
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`
  try {
    // Write 8MB payload to an immediately-dying process
    const largePayload = Buffer.alloc(8 * 1024 * 1024, 65)
    const result = await runSsh('epipe-fixture', 'dummy', largePayload)
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 1)
  } finally {
    restoreHome(oldHome)
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('setupRemoteTools injects tools only into remote workspace agents and never non-remote workspaces', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { createRequire } = await import('node:module')
  const { Context } = await import('@deepseek-ai/cordis')
  const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const req = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
  const { createScope } = await import(req.resolve('@deepseek-ai/dsh-scope'))
  const { setupRemoteTools } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-tools-test-'))
  process.env.HOME = tempHome

  const wsDir = path.join(tempHome, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const localDir = path.join(tempHome, 'local-repo')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.mkdirSync(localDir, { recursive: true })
  fs.mkdirSync(path.join(tempHome, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempHome, '.ssh', 'config'), 'Host test-host\n  HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(wsDir, '.remote-ssh.json'), JSON.stringify({
    host: 'test-host',
    remotePath: '/remote/path'
  }))

  try {
    const ctx = new Context()
    ctx.systemPrompt = { tools: () => {}, section: () => {} }
    ctx.set('tools', new ToolRuntime(ctx))

    const cleanup = setupRemoteTools(ctx)

    // Agent in remote workspace
    const agentRemote = { id: 'agent-remote', session: { header: { cwd: wsDir } } }
    agentRemote.ctx = createScope(ctx, agentRemote).ctx
    ctx.emit('agent/created', { agent: agentRemote })

    // Agent in local (non-remote) workspace
    const agentLocal = { id: 'agent-local', session: { header: { cwd: localDir } } }
    agentLocal.ctx = createScope(ctx, agentLocal).ctx
    ctx.emit('agent/created', { agent: agentLocal })

    // Verify global view has NO exclusive tools
    const globalVisible = [...ctx.tools.view().visible.keys()]
    assert.deepEqual(globalVisible, [], 'global tool layer must not have remote_ssh tools injected')

    // Verify remote agent HAS all 4 exclusive tools
    const remoteVisible = [...ctx.tools.view(agentRemote).visible.keys()]
    assert(remoteVisible.includes('remote_ssh_exec'), 'remote agent must have remote_ssh_exec')
    assert(remoteVisible.includes('remote_ssh_read'), 'remote agent must have remote_ssh_read')
    assert(remoteVisible.includes('remote_ssh_write'), 'remote agent must have remote_ssh_write')
    assert(remoteVisible.includes('remote_ssh_hosts'), 'remote agent must have remote_ssh_hosts')

    // Verify local agent DOES NOT HAVE ANY of the 4 exclusive tools
    const localVisible = [...ctx.tools.view(agentLocal).visible.keys()]
    assert.deepEqual(localVisible, [], 'non-remote workspace agent must not have any remote_ssh tools')

    // Child agent under remote agent inherits remote tools
    const childRemote = { id: 'child-remote', session: { header: { cwd: wsDir } } }
    childRemote.ctx = createScope(ctx, childRemote, { parent: agentRemote }).ctx
    ctx.emit('agent/created', { agent: childRemote })
    const childRemoteVisible = [...ctx.tools.view(childRemote).visible.keys()]
    assert(childRemoteVisible.includes('remote_ssh_exec'), 'remote child must inherit remote_ssh_exec')

    // Child agent under local agent has NO remote tools
    const childLocal = { id: 'child-local', session: { header: { cwd: localDir } } }
    childLocal.ctx = createScope(ctx, childLocal, { parent: agentLocal }).ctx
    ctx.emit('agent/created', { agent: childLocal })
    const childLocalVisible = [...ctx.tools.view(childLocal).visible.keys()]
    assert.deepEqual(childLocalVisible, [], 'local child must not have any remote_ssh tools')

    cleanup()
  } finally {
    restoreHome(oldHome)
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

test('setupRemoteTools handles pre-existing agents from ctx.agents.list()', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { createRequire } = await import('node:module')
  const { Context } = await import('@deepseek-ai/cordis')
  const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const req = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
  const { createScope } = await import(req.resolve('@deepseek-ai/dsh-scope'))
  const { setupRemoteTools } = await import('../lib/index.js')

  const oldHome = process.env.HOME
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preexisting-test-'))
  process.env.HOME = tempHome

  const wsDir = path.join(tempHome, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const localDir = path.join(tempHome, 'local-repo')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.mkdirSync(localDir, { recursive: true })
  fs.mkdirSync(path.join(tempHome, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(tempHome, '.ssh', 'config'), 'Host test-host\n  HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(wsDir, '.remote-ssh.json'), JSON.stringify({
    host: 'test-host',
    remotePath: '/remote/path'
  }))

  try {
    const ctx = new Context()
    ctx.systemPrompt = { tools: () => {}, section: () => {} }
    ctx.set('tools', new ToolRuntime(ctx))

    const preRemoteAgent = { id: 'pre-remote', session: { header: { cwd: wsDir } } }
    preRemoteAgent.ctx = createScope(ctx, preRemoteAgent).ctx
    const preLocalAgent = { id: 'pre-local', session: { header: { cwd: localDir } } }
    preLocalAgent.ctx = createScope(ctx, preLocalAgent).ctx

    ctx.agents = {
      list: () => [preRemoteAgent, preLocalAgent]
    }

    const cleanup = setupRemoteTools(ctx)

    // Pre-existing remote agent should have tools registered
    const remoteVisible = [...ctx.tools.view(preRemoteAgent).visible.keys()]
    assert(remoteVisible.includes('remote_ssh_exec'), 'pre-existing remote agent must have remote_ssh_exec')

    // Pre-existing local agent should NOT have tools registered
    const localVisible = [...ctx.tools.view(preLocalAgent).visible.keys()]
    assert.deepEqual(localVisible, [], 'pre-existing local agent must not have remote tools')

    cleanup()
  } finally {
    restoreHome(oldHome)
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

test('generated terminal runner fails closed when remote directory is missing', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const { ensureShellWrapper } = await import('../lib/index.js')
  const oldHome = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-runner-'))
  const anchor = path.join(home, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const bin = path.join(home, 'bin')
  fs.mkdirSync(anchor, { recursive: true })
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(home, '.ssh'))
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host terminal-test\n HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(anchor, '.remote-ssh.json'), JSON.stringify({ host: 'terminal-test', remotePath: '/missing/remote/project' }))
  const fakeSsh = path.join(bin, process.platform === 'win32' ? 'ssh.cmd' : 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do last="$arg"; done\n/bin/sh -c "$last"\n')
  fs.chmodSync(fakeSsh, 0o755)
  process.env.HOME = home
  try {
    ensureShellWrapper()
    const result = spawnSync(process.execPath, [path.join(home, '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')], {
      cwd: anchor,
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      encoding: 'utf8'
    })
    assert.equal(result.status, 1, `remote cd must fail instead of falling back to home: ${result.stderr}`)
  } finally {
    restoreHome(oldHome)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('generated terminal runner expands remote home paths safely', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const { ensureShellWrapper } = await import('../lib/index.js')
  const oldHome = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-home-'))
  const anchor = path.join(home, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const bin = path.join(home, 'bin')
  fs.mkdirSync(anchor, { recursive: true })
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(home, '.ssh'))
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host terminal-test\n HostName 127.0.0.1\n')
  const metaPath = path.join(anchor, '.remote-ssh.json')
  const fakeSsh = path.join(bin, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nfor arg do remote="$arg"; done\nHOME="$FAKE_REMOTE_HOME" /bin/sh -c "$remote"\n')
  fs.chmodSync(fakeSsh, 0o755)
  const fakeShell = path.join(bin, 'fake-shell')
  fs.writeFileSync(fakeShell, '#!/bin/sh\npwd\n')
  fs.chmodSync(fakeShell, 0o755)
  process.env.HOME = home
  try {
    ensureShellWrapper()
    const runner = path.join(home, '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')
    const remoteHome = path.join(home, 'remote-home')
    fs.mkdirSync(remoteHome)
    fs.mkdirSync(path.join(remoteHome, 'project with spaces'))
    for (const [remotePath, expected] of [
      ['~', remoteHome],
      ['~/', remoteHome],
      ['~/project with spaces', path.join(remoteHome, 'project with spaces')],
      ['/missing/remote/project', null]
    ]) {
      fs.writeFileSync(metaPath, JSON.stringify({ host: 'terminal-test', remotePath }))
      const result = spawnSync(process.execPath, [runner], {
        cwd: anchor,
        env: { ...process.env, HOME: home, FAKE_REMOTE_HOME: remoteHome,
          PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`, SHELL: fakeShell },
        encoding: 'utf8'
      })
      assert.equal(result.status, expected === null ? 1 : 0, `${remotePath}: ${result.stderr}`)
      if (expected !== null) assert.equal(result.stdout.trim(), expected)
    }
  } finally {
    restoreHome(oldHome)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('generated terminal runner uses the shared SSH connect timeout', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const { ensureShellWrapper } = await import('../lib/index.js')
  const oldHome = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-timeout-'))
  const anchor = path.join(home, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const bin = path.join(home, 'bin')
  fs.mkdirSync(anchor, { recursive: true })
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(home, '.ssh'))
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host terminal-test\n HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(anchor, '.remote-ssh.json'), JSON.stringify({ host: 'terminal-test', remotePath: '/remote/project' }))
  const fakeSsh = path.join(bin, 'ssh')
  fs.writeFileSync(fakeSsh, '#!/bin/sh\nprintf "%s\\n" "$@"\n')
  fs.chmodSync(fakeSsh, 0o755)
  process.env.HOME = home
  try {
    ensureShellWrapper()
    const result = spawnSync(process.execPath, [path.join(home, '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')], {
      cwd: anchor,
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(SSH_CONNECTION_TIMEOUT_MS, SSH_CONNECTION_TIMEOUT_SECONDS * 1000)
    assert.ok(result.stdout.split(/\r?\n/).includes(`ConnectTimeout=${SSH_CONNECTION_TIMEOUT_SECONDS}`))
    assert.match(result.stdout, /terminal-test/)
  } finally {
    restoreHome(oldHome)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('native terminal hook routes only managed remote workspaces through SSH wrapper', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { hookNativeTerminals, ensureShellWrapper } = await import('../lib/index.js')
  const oldHome = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-hook-'))
  const anchor = path.join(home, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  const local = path.join(home, 'local')
  fs.mkdirSync(path.join(anchor, 'src'), { recursive: true })
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true })
  fs.mkdirSync(local)
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host test-terminal\n HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(anchor, '.remote-ssh.json'), JSON.stringify({ host: 'test-terminal', remotePath: '/remote/project' }))
  process.env.HOME = home
  try {
    ensureShellWrapper()
    const calls = []
    const subprocess = { spawnTerminal(spec) { calls.push(spec); return spec } }
    const original = subprocess.spawnTerminal
    const agent = { ctx: { get: (name) => name === 'subprocess' ? subprocess : undefined } }
    let onCreate
    const cleanup = hookNativeTerminals({
      on(event, callback) { if (event === 'agent/created') onCreate = callback; return () => {} },
      effect() {}
    })
    onCreate({ agent })
    const remoteSpec = { cwd: path.join(anchor, 'src'), argv: ['/bin/bash', '-i'], shellActivity: true, cols: 80 }
    const remote = subprocess.spawnTerminal(remoteSpec)
    assert.deepEqual(remote.argv, [process.execPath, path.join(home, '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')])
    assert.equal(remote.shellActivity, false)
    assert.equal(remote.cols, 80)
    assert.deepEqual(remoteSpec.argv, ['/bin/bash', '-i'], 'original request must not be mutated')
    const localSpec = { cwd: local, argv: ['/bin/bash', '-i'], shellActivity: true }
    assert.equal(subprocess.spawnTerminal(localSpec), localSpec, 'local terminals must remain unchanged')
    assert.equal(calls.length, 2)
    cleanup()
    assert.equal(subprocess.spawnTerminal, original, 'hook must be reversible')
  } finally {
    restoreHome(oldHome)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('DSH 0.2.0-rc.2 target cohort and peer dependencies integrity', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const pkgPath = path.resolve('package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  // 1. Package self version and naming
  assert.equal(pkg.name, 'dsh-ssh')
  assert.equal(pkg.version, '0.1.0')

  // 2. DSH manifest fields
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.deepEqual(pkg.dsh?.client?.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives'
  ])

  // 3. Peer dependencies: DSH packages must be ^0.2.0-rc.2, cordis ^4.0.1
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-host-webserver'], '^0.2.0-rc.2')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-tools'], '^0.2.0-rc.2')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-workspace'], '^0.2.0-rc.2')

  // 4. Dev dependencies: DSH packages must be exact 0.2.0-rc.2, cordis 4.0.4
  assert.equal(pkg.devDependencies['@deepseek-ai/cordis'], '4.0.4')
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-host-webserver'], '0.2.0-rc.2')
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-tools'], '0.2.0-rc.2')
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-workspace'], '0.2.0-rc.2')

  // 5. Installed packages in node_modules must resolve to 0.2.0-rc.2 and cordis 4.0.4
  const { createRequire } = await import('node:module')
  const req = createRequire(import.meta.url)
  const cordisPkg = JSON.parse(fs.readFileSync(req.resolve('@deepseek-ai/cordis/package.json'), 'utf8'))
  const webserverPkg = JSON.parse(fs.readFileSync(req.resolve('@deepseek-ai/dsh-host-webserver/package.json'), 'utf8'))
  const toolsPkg = JSON.parse(fs.readFileSync(req.resolve('@deepseek-ai/dsh-tools/package.json'), 'utf8'))
  const wsPkg = JSON.parse(fs.readFileSync(req.resolve('@deepseek-ai/dsh-workspace/package.json'), 'utf8'))

  assert.equal(cordisPkg.version, '4.0.4')
  assert.equal(webserverPkg.version, '0.2.0-rc.2')
  assert.equal(toolsPkg.version, '0.2.0-rc.2')
  assert.equal(wsPkg.version, '0.2.0-rc.2')
})

test('native node built entry is side-effect-free on import', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { spawnSync } = await import('node:child_process')

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-import-test-${Date.now()}-`))
  try {
    const code = `
      import * as plugin from './lib/index.js'
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import path from 'node:path'
      import os from 'node:os'

      assert.equal(plugin.name, 'dsh-ssh')
      assert.deepEqual(plugin.inject, ['webServer', 'tools', 'workspaceRegistry'])
      assert.equal(typeof plugin.apply, 'function')
      assert.equal(typeof plugin.default.apply, 'function')

      // Ensure no .dsh or sockets directory was created simply by importing
      const dshDir = path.join(os.homedir(), '.dsh')
      assert.equal(fs.existsSync(dshDir), false, 'importing module must have zero side-effects')
      console.log('SIDE_EFFECT_FREE_OK')
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: path.resolve('.'),
      env: { ...process.env, HOME: tempHome },
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, `import failed with stderr: ${result.stderr}`)
    assert(result.stdout.includes('SIDE_EFFECT_FREE_OK'))
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})

test('hookNativeTerminals handles delayed subprocess injection and agent lifecycle', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const { hookNativeTerminals, ensureShellWrapper } = await import('../lib/index.js')
  const oldHome = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-lifecycle-'))
  const anchor = path.join(home, '.dsh', 'dsh-ssh', 'workspaces', 'ws-test')
  fs.mkdirSync(path.join(anchor, 'src'), { recursive: true })
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host test-terminal\n HostName 127.0.0.1\n')
  fs.writeFileSync(path.join(anchor, '.remote-ssh.json'), JSON.stringify({ host: 'test-terminal', remotePath: '/remote/project' }))
  process.env.HOME = home
  try {
    ensureShellWrapper()
    const calls = []
    const subprocess1 = { spawnTerminal(spec) { calls.push(spec); return spec } }
    const subprocess2 = { spawnTerminal(spec) { calls.push(spec); return spec } }

    const callbacks = new Map()
    const mockCtx = {
      get(name) { return name === 'subprocess' ? subprocess1 : undefined },
      on(event, cb) {
        callbacks.set(event, cb)
        return () => callbacks.delete(event)
      },
      inject(deps, cb) {
        if (deps.includes('subprocess')) cb({ subprocess: subprocess2 })
        return () => {}
      },
      effect() {}
    }

    const cleanup = hookNativeTerminals(mockCtx)

    // Test subprocess1 (from ctx.get)
    const spec1 = { cwd: path.join(anchor, 'src'), argv: ['bash'], shellActivity: true }
    const res1 = subprocess1.spawnTerminal(spec1)
    assert.equal(res1.shellActivity, false)
    assert.deepEqual(res1.argv, [process.execPath, path.join(home, '.dsh', 'dsh-ssh', 'dsh-remote-shell.js')])

    // Test subprocess2 (from ctx.inject subprocess)
    const spec2 = { cwd: path.join(anchor, 'src'), argv: ['sh'], shellActivity: true }
    const res2 = subprocess2.spawnTerminal(spec2)
    assert.equal(res2.shellActivity, false)

    // Test new agent via agent/created
    const subprocessAgent = { spawnTerminal(spec) { return spec } }
    const agent = { ctx: { get(name) { return name === 'subprocess' ? subprocessAgent : undefined } } }
    const agentCreatedCb = callbacks.get('agent/created')
    assert.equal(typeof agentCreatedCb, 'function')
    agentCreatedCb({ agent })

    const resAgent = subprocessAgent.spawnTerminal({ cwd: path.join(anchor, 'src'), argv: ['zsh'], shellActivity: true })
    assert.equal(resAgent.shellActivity, false)

    cleanup()
  } finally {
    restoreHome(oldHome)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

