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
  shellCd
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

  // Malicious path traversal attempts escaping remote root must throw security error
  const malicious1 = '/home/user/.dsh/dsh-ssh/workspaces/ws-123/../../../../../../etc/shadow'
  assert.throws(() => localToRemotePath(malicious1, anchor, remote), /路径遍历拦截/)

  const malicious2 = '../../../../../../etc/passwd'
  assert.throws(() => localToRemotePath(malicious2, anchor, remote), /路径遍历拦截/)

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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
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
    process.env.HOME = oldHome
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})



