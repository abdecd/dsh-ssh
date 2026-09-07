// src/workspace.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync, rmSync, chmodSync as chmodSync2, realpathSync } from "node:fs";
import { join as join3, dirname, basename, resolve, sep, posix } from "node:path";
import { homedir as homedir3 } from "node:os";

// src/connection.ts
import { spawn } from "node:child_process";
import { mkdirSync, existsSync as existsSync2, chmodSync } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";

// src/config.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
function parseSshConfig(customPath) {
  const configPath = customPath || join(homedir(), ".ssh", "config");
  if (!existsSync(configPath)) {
    return [];
  }
  try {
    const content = readFileSync(configPath, "utf8");
    const lines = content.split(/\r?\n/);
    const hosts = [];
    let currentEntries = [];
    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf("#");
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const key = parts[0]?.toLowerCase();
      const value = parts.slice(1).join(" ").trim();
      if (key === "host") {
        const aliases = parts.slice(1).filter((a) => a && !a.includes("*") && !a.includes("?") && !a.startsWith("-"));
        currentEntries = [];
        for (const alias of aliases) {
          const entry = { host: alias };
          currentEntries.push(entry);
          hosts.push(entry);
        }
      } else if (currentEntries.length > 0) {
        for (const current of currentEntries) {
          if (key === "hostname") current.hostName = value;
          else if (key === "user") current.user = value;
          else if (key === "port") current.port = parseInt(value, 10) || 22;
          else if (key === "identityfile") current.identityFile = value.replace(/^~(?=$|\/|\\)/, homedir());
          else if (key === "proxyjump") current.proxyJump = value;
          else if (key === "passwordauthentication") {
            current.passwordAuthentication = value.toLowerCase() === "yes";
          }
        }
      }
    }
    return hosts;
  } catch (err) {
    console.error("[dsh-ssh] Failed to read ~/.ssh/config:", err);
    return [];
  }
}
function isValidSshHost(host, customPath) {
  if (!host || typeof host !== "string") return false;
  const clean = host.trim();
  if (!clean || clean.startsWith("-") || !/^[a-zA-Z0-9_.-]+$/.test(clean)) {
    return false;
  }
  const validHosts = parseSshConfig(customPath);
  return validHosts.some((h) => h.host.toLowerCase() === clean.toLowerCase());
}

// src/connection.ts
var MAX_BYTES = 10 * 1024 * 1024;
var CACHE_TTL_MS = 5e3;
var memoryPasswords = /* @__PURE__ */ new Map();
function setHostPassword(host, pass) {
  if (!pass) {
    memoryPasswords.delete(host);
  } else {
    memoryPasswords.set(host, pass);
  }
}
function getHostPassword(host) {
  return memoryPasswords.get(host);
}
function hasHostPassword(host) {
  return memoryPasswords.has(host);
}
function removeHostPassword(host) {
  memoryPasswords.delete(host);
}
function getSocketDir() {
  const dir = join2(homedir2(), ".dsh", "dsh-ssh", "sockets");
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  try {
    chmodSync(dir, 448);
  } catch {
  }
  return dir;
}
function shellQuote(p) {
  if (!p) return "''";
  return "'" + String(p).replace(/'/g, "'\\''") + "'";
}
function translateSshError(text) {
  const t = String(text || "");
  if (/permission denied \(publickey,password/i.test(t)) {
    return "SSH \u8BA4\u8BC1\u5931\u8D25\uFF1A\u5BC6\u7801\u9519\u8BEF\u6216\u516C\u94A5\u672A\u914D\u7F6E\u3002";
  }
  if (/permission denied \(publickey/i.test(t)) {
    return "SSH \u516C\u94A5\u8BA4\u8BC1\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u79C1\u94A5\u914D\u7F6E\u6216\u76EE\u6807\u4E3B\u673A\u7684 ~/.ssh/authorized_keys \u4E2D\u5DF2\u6DFB\u52A0\u5BF9\u5E94\u516C\u94A5\u3002";
  }
  if (/permission denied/i.test(t)) {
    return "SSH \u8BA4\u8BC1\u5931\u8D25\uFF1A\u5BC6\u7801\u9519\u8BEF\u6216\u65E0\u8BBF\u95EE\u6743\u9650\u3002";
  }
  if (/connection refused/i.test(t)) {
    return "SSH \u8FDE\u63A5\u88AB\u62D2\u7EDD\uFF1A\u8BF7\u786E\u8BA4\u76EE\u6807\u4E3B\u673A\u5DF2\u5F00\u673A\u3001sshd \u670D\u52A1\u5DF2\u542F\u52A8\u4E14\u7AEF\u53E3\u5F00\u653E\u3002";
  }
  if (/connection timed out|timed out|operation timed out/i.test(t)) {
    return "SSH \u8FDE\u63A5\u8D85\u65F6\uFF1A\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u901A\u6027\u3001\u9632\u706B\u5899\u89C4\u5219\u6216\u8DF3\u677F\u673A (ProxyJump) \u914D\u7F6E\u3002";
  }
  if (/could not resolve hostname/i.test(t)) {
    return "\u65E0\u6CD5\u89E3\u6790\u4E3B\u673A\u540D\uFF1A\u8BF7\u68C0\u67E5 ~/.ssh/config \u4E2D\u7684 HostName \u62FC\u5199\u3002";
  }
  return t.trim().slice(0, 500);
}
async function runSsh(host, command, stdinData, timeoutMs = 3e4) {
  if (!isValidSshHost(host)) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      error: `SSH \u4E3B\u673A\u6821\u9A8C\u5931\u8D25\uFF1A\u4E3B\u673A "${host}" \u4E0D\u5728\u5408\u6CD5 ~/.ssh/config \u914D\u7F6E\u5217\u8868\u4E2D\u6216\u5305\u542B\u975E\u6CD5\u5B57\u7B26`
    };
  }
  const socketDir = getSocketDir();
  const socketPath = join2(socketDir, "%r@%h:%p");
  const password = getHostPassword(host);
  const baseArgs = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${socketPath}`,
    "-o",
    "ControlPersist=10m"
  ];
  if (!password) {
    baseArgs.push("-o", "BatchMode=yes");
  }
  baseArgs.push("--", host, command);
  let bin = "ssh";
  let finalArgs = baseArgs;
  let env = process.env;
  if (password) {
    bin = "sshpass";
    finalArgs = ["-e", "ssh", ...baseArgs];
    env = { ...process.env, SSHPASS: password };
  }
  return new Promise((resolve2) => {
    let stdoutText = "";
    let stderrText = "";
    let resolved = false;
    const child = spawn(bin, finalArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGKILL");
        } catch {
        }
        resolve2({
          ok: false,
          exitCode: -1,
          stdout: stdoutText,
          stderr: stderrText,
          error: `SSH \u547D\u4EE4\u6267\u884C\u8D85\u65F6 (${timeoutMs / 1e3}s)`
        });
      }
    }, timeoutMs);
    if (stdinData !== void 0 && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }
    child.stdout?.on("data", (chunk) => {
      if (stdoutText.length < MAX_BYTES) {
        stdoutText += chunk.toString("utf8");
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderrText.length < 512 * 1024) {
        stderrText += chunk.toString("utf8");
      }
    });
    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve2({
          ok: false,
          exitCode: -1,
          stdout: stdoutText,
          stderr: stderrText,
          error: "SSH \u8FDB\u7A0B\u542F\u52A8\u5931\u8D25: " + err.message
        });
      }
    });
    child.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const exitCode = code ?? 0;
        const ok = exitCode === 0;
        const errHint = !ok ? translateSshError(stderrText) || `SSH \u9000\u51FA\u7801: ${exitCode}` : void 0;
        resolve2({
          ok,
          exitCode,
          stdout: stdoutText,
          stderr: stderrText,
          error: errHint
        });
      }
    });
  });
}
var MAX_CACHE_ENTRIES = 100;
var listCache = /* @__PURE__ */ new Map();
var readCache = /* @__PURE__ */ new Map();
function setCacheItem(map, key, data) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== void 0) {
      map.delete(oldestKey);
    }
  }
  map.set(key, { data, timestamp: Date.now() });
}
function getCacheItem(map, key) {
  const item = map.get(key);
  if (!item) return void 0;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    map.delete(key);
    return void 0;
  }
  map.delete(key);
  map.set(key, item);
  return item.data;
}
function invalidateCache(host, remotePath) {
  if (!host) {
    listCache.clear();
    readCache.clear();
    return;
  }
  const prefix = remotePath ? `${host}|${remotePath}` : `${host}|`;
  for (const k of listCache.keys()) {
    if (k.startsWith(prefix)) listCache.delete(k);
  }
  for (const k of readCache.keys()) {
    if (k.startsWith(prefix)) readCache.delete(k);
  }
}
async function remoteListDir(host, remotePath, localDisplayPath) {
  const cacheKey = `${host}|${remotePath}`;
  const cached = getCacheItem(listCache, cacheKey);
  if (cached) {
    return {
      ok: true,
      data: {
        path: localDisplayPath,
        entries: cached.entries.map((e) => ({
          ...e,
          path: localDisplayPath.endsWith("/") || localDisplayPath.endsWith("\\") ? `${localDisplayPath}${e.name}` : `${localDisplayPath}/${e.name}`
        })),
        truncated: cached.truncated
      }
    };
  }
  const script = `( cd ${shellQuote(remotePath)} 2>/dev/null || { echo '__DSH_ERR_CD__'; exit 1; }; find . -maxdepth 1 -mindepth 1 -printf '%Y\\t%f\\t%s\\n' 2>/dev/null || ls -1ap 2>/dev/null )`;
  const r = await runSsh(host, script);
  if (!r.ok) {
    if (r.stdout.includes("__DSH_ERR_CD__")) {
      return { ok: false, error: `\u8FDC\u7A0B\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u65E0\u8BBF\u95EE\u6743\u9650: ${remotePath}` };
    }
    return { ok: false, error: r.error || r.stderr || "\u8BFB\u53D6\u8FDC\u7A0B\u76EE\u5F55\u5931\u8D25" };
  }
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    if (line.includes("	")) {
      const [type, name2, _size] = line.split("	");
      if (!name2 || name2 === "." || name2 === "..") continue;
      const isDir = type === "d";
      const isSymlink = type === "l";
      entries.push({
        name: name2,
        path: localDisplayPath.endsWith("/") || localDisplayPath.endsWith("\\") ? `${localDisplayPath}${name2}` : `${localDisplayPath}/${name2}`,
        isDir,
        isSymlink,
        broken: false,
        hidden: name2.startsWith(".")
      });
    } else {
      let name2 = line.trim();
      if (!name2 || name2 === "./" || name2 === "../") continue;
      const isDir = name2.endsWith("/");
      if (isDir) name2 = name2.slice(0, -1);
      entries.push({
        name: name2,
        path: localDisplayPath.endsWith("/") || localDisplayPath.endsWith("\\") ? `${localDisplayPath}${name2}` : `${localDisplayPath}/${name2}`,
        isDir,
        isSymlink: false,
        broken: false,
        hidden: name2.startsWith(".")
      });
    }
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
  });
  const listing = {
    path: localDisplayPath,
    entries,
    truncated: entries.length >= 1e3
  };
  setCacheItem(listCache, cacheKey, listing);
  return { ok: true, data: listing };
}
async function remoteReadFile(host, remotePath) {
  const cacheKey = `${host}|${remotePath}`;
  const cached = getCacheItem(readCache, cacheKey);
  if (cached) {
    return cached;
  }
  const script = `( [ -f ${shellQuote(remotePath)} ] || { echo '__DSH_ERR_NOT_FOUND__'; exit 1; }; base64 < ${shellQuote(remotePath)} 2>/dev/null )`;
  const r = await runSsh(host, script);
  if (!r.ok) {
    if (r.stdout.includes("__DSH_ERR_NOT_FOUND__")) {
      return { ok: false, error: `\u8FDC\u7A0B\u6587\u4EF6\u4E0D\u5B58\u5728: ${remotePath}` };
    }
    return { ok: false, error: r.error || r.stderr || "\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25" };
  }
  const rawB64 = r.stdout.replace(/\s+/g, "");
  let buffer;
  try {
    buffer = Buffer.from(rawB64, "base64");
  } catch (e) {
    return { ok: false, error: "\u89E3\u7801\u8FDC\u7A0B\u6587\u4EF6\u5931\u8D25: " + String(e) };
  }
  const probeSlice = buffer.subarray(0, Math.min(buffer.length, 8e3));
  const isBinary = probeSlice.includes(0);
  let result;
  if (isBinary) {
    result = {
      ok: true,
      kind: "binary",
      size: buffer.length,
      head: buffer.subarray(0, Math.min(buffer.length, 4096)).toString("base64"),
      truncated: buffer.length > MAX_BYTES
    };
  } else {
    result = {
      ok: true,
      kind: "text",
      size: buffer.length,
      content: buffer.toString("utf8"),
      truncated: buffer.length > MAX_BYTES
    };
  }
  setCacheItem(readCache, cacheKey, result);
  return result;
}
async function remoteWriteFile(host, remotePath, content) {
  const b64 = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(String(content), "utf8").toString("base64");
  const dirname2 = remotePath.split("/").slice(0, -1).join("/") || ".";
  const script = `mkdir -p ${shellQuote(dirname2)} && base64 -d > ${shellQuote(remotePath)}`;
  const r = await runSsh(host, script, b64);
  invalidateCache(host, remotePath);
  if (!r.ok) {
    return { ok: false, error: r.error || r.stderr || "\u8FDC\u7A0B\u6587\u4EF6\u4FDD\u5B58\u5931\u8D25" };
  }
  return { ok: true };
}
async function remoteSearchFiles(host, remotePath, localDisplayPath, query) {
  if (!query) return { ok: true, entries: [], truncated: false };
  const q = `*${query}*`;
  const script = `( cd ${shellQuote(remotePath)} 2>/dev/null && find . -maxdepth 5 -name ${shellQuote(q)} 2>/dev/null | head -n 300 )`;
  const r = await runSsh(host, script);
  if (!r.ok) {
    return { ok: false, entries: [], truncated: false, error: r.error || "\u8FDC\u7A0B\u641C\u7D22\u5931\u8D25" };
  }
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const rel = line.replace(/^\.\//, "");
    if (!rel) continue;
    entries.push({
      path: localDisplayPath.endsWith("/") || localDisplayPath.endsWith("\\") ? `${localDisplayPath}${rel}` : `${localDisplayPath}/${rel}`,
      isDir: false
    });
  }
  return { ok: true, entries, truncated: entries.length >= 300 };
}
async function testSshConnection(host, password) {
  if (password) {
    setHostPassword(host, password);
  }
  const r = await runSsh(host, 'echo "OK"', void 0, 8e3);
  if (r.ok && r.stdout.includes("OK")) {
    return { ok: true, message: "\u8FDE\u63A5\u6210\u529F\uFF01" };
  }
  if (password && !r.ok) {
    removeHostPassword(host);
  }
  return { ok: false, message: r.error || r.stderr || "\u8FDE\u63A5\u5931\u8D25" };
}

// src/workspace.ts
function getBaseDir() {
  const dir = join3(homedir3(), ".dsh", "dsh-ssh");
  if (!existsSync3(dir)) {
    mkdirSync2(dir, { recursive: true });
  }
  return dir;
}
function getWorkspacesDir() {
  const dir = join3(getBaseDir(), "workspaces");
  if (!existsSync3(dir)) {
    mkdirSync2(dir, { recursive: true });
  }
  return dir;
}
function findRemoteWorkspaceMeta(startPath) {
  if (!startPath) return null;
  let current = startPath;
  const root = dirname(current);
  while (current && current !== root) {
    const metaPath = join3(current, ".remote-ssh.json");
    if (existsSync3(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync2(metaPath, "utf8"));
        if (meta && meta.host && meta.remotePath) {
          return { meta, anchorDir: current };
        }
      } catch {
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function localToRemotePath(localPath, anchorDir, remoteRoot) {
  if (!localPath) return remoteRoot;
  const normLocal = posix.normalize(localPath.replace(/\\/g, "/"));
  const normAnchor = posix.normalize(anchorDir.replace(/\\/g, "/"));
  const cleanBase = posix.normalize(remoteRoot.replace(/\\/g, "/"));
  let rel = "";
  if (normLocal === normAnchor) {
    return cleanBase;
  }
  if (normLocal.startsWith(normAnchor.endsWith("/") ? normAnchor : normAnchor + "/")) {
    rel = normLocal.slice(normAnchor.length).replace(/^\/+/, "");
  } else {
    rel = posix.relative(normAnchor, normLocal);
  }
  if (!rel || rel === ".") return cleanBase;
  const candidate = posix.resolve(cleanBase, rel);
  if (cleanBase !== "/" && !candidate.startsWith(cleanBase.endsWith("/") ? cleanBase : cleanBase + "/") && candidate !== cleanBase) {
    return cleanBase;
  }
  return candidate;
}
async function createRemoteWorkspace(workspaceRegistry, host, remotePath, customTitle, authType, password) {
  try {
    const id = "ws-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const anchorDir = join3(getWorkspacesDir(), id);
    mkdirSync2(anchorDir, { recursive: true });
    const cleanRemote = remotePath.trim().replace(/\/+$/, "") || "/";
    const folderName = basename(cleanRemote) || cleanRemote;
    const title = customTitle || `${folderName} (${host})`;
    const isPassword = authType === "password";
    if (isPassword && password) {
      setHostPassword(host, password);
    }
    const meta = {
      host,
      remotePath: cleanRemote,
      title,
      createdAt: Date.now(),
      authType: isPassword ? "password" : "key"
    };
    writeFileSync(join3(anchorDir, ".remote-ssh.json"), JSON.stringify(meta, null, 2), "utf8");
    const agentsMd = [
      `# Remote Workspace: ${title}`,
      "",
      `This directory is a local anchor for remote SSH host: \`${host}\``,
      `Remote path: \`${cleanRemote}\``,
      "",
      "AI models must use `remote_ssh_*` tools (`remote_ssh_exec`, `remote_ssh_read`, `remote_ssh_write`) to directly execute commands and read/write remote files."
    ].join("\n");
    writeFileSync(join3(anchorDir, "AGENTS.md"), agentsMd, "utf8");
    let workspaceId;
    if (workspaceRegistry && typeof workspaceRegistry.create === "function") {
      const native = await workspaceRegistry.create(anchorDir, title);
      workspaceId = native?.id;
    }
    return {
      ok: true,
      workspaceId,
      anchorDir,
      title
    };
  } catch (err) {
    return { ok: false, error: "\u521B\u5EFA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u5931\u8D25: " + (err?.message || String(err)) };
  }
}
async function deleteRemoteWorkspace(workspaceRegistry, anchorDir) {
  try {
    const wsDir = resolve(getWorkspacesDir());
    const target = resolve(anchorDir);
    if (!target.startsWith(wsDir + sep) || target === wsDir) {
      return { ok: false, error: "\u6743\u9650\u62D2\u7EDD\uFF1A\u53EA\u80FD\u5220\u9664\u4F4D\u4E8E workspaces \u76EE\u5F55\u4E0B\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u951A\u70B9\u76EE\u5F55" };
    }
    if (workspaceRegistry && typeof workspaceRegistry.resolveByPath === "function") {
      const entity = await workspaceRegistry.resolveByPath(target);
      if (entity && typeof workspaceRegistry.delete === "function") {
        await workspaceRegistry.delete(entity.id);
      }
    }
    if (existsSync3(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "\u5220\u9664\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u5931\u8D25: " + (err?.message || String(err)) };
  }
}
function hookWorkspaceRegistryDeletion(ctx) {
  const reg = ctx.workspaceRegistry;
  if (!reg || typeof reg.delete !== "function" || reg.__dshSshHooked) return;
  reg.__dshSshHooked = true;
  const originalDelete = reg.delete.bind(reg);
  const wsBaseDir = getWorkspacesDir().toLowerCase();
  reg.delete = async function(id) {
    let anchorToRemove = null;
    try {
      const entity = typeof reg.get === "function" ? reg.get(id) : null;
      if (entity && entity.path) {
        const p = String(entity.path);
        let canon = p.toLowerCase();
        try {
          canon = realpathSync(p).toLowerCase();
        } catch {
        }
        if (canon.startsWith(wsBaseDir) || p.toLowerCase().startsWith(wsBaseDir)) {
          anchorToRemove = p;
        }
      }
    } catch {
    }
    const result = await originalDelete(id);
    if (anchorToRemove) {
      try {
        if (existsSync3(anchorToRemove)) {
          rmSync(anchorToRemove, { recursive: true, force: true });
          console.log("[dsh-ssh] Removed anchor directory on workspace deletion:", anchorToRemove);
        }
      } catch (err) {
        console.warn("[dsh-ssh] Failed to remove anchor directory:", anchorToRemove, err);
      }
    }
    return result;
  };
}
function ensureShellWrapper() {
  const baseDir = getBaseDir();
  const runnerJs = `// dsh-ssh terminal wrapper
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function shellQuote(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "'\\\\''") + "'";
}

let cur = process.cwd();
let meta = null;
const root = path.dirname(cur);

while (cur && cur !== root) {
  const p = path.join(cur, '.remote-ssh.json');
  if (fs.existsSync(p)) {
    try { meta = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    break;
  }
  const parent = path.dirname(cur);
  if (parent === cur) break;
  cur = parent;
}

if (meta && meta.host && typeof meta.host === 'string') {
  const host = meta.host.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(host) || host.startsWith('-')) {
    console.error('[dsh-ssh] \u975E\u6CD5\u6216\u4E0D\u5B89\u5168\u7684 SSH \u4E3B\u673A\u540D: ' + host);
    process.exit(1);
  }
  const remotePath = meta.remotePath;
  let remoteCmd = undefined;
  if (remotePath) {
    remoteCmd = 'cd ' + shellQuote(remotePath) + ' 2>/dev/null; exec \${SHELL:-/bin/bash} -l';
  }
  const socketPath = path.join(require('os').homedir(), '.dsh', 'dsh-ssh', 'sockets', '%r@%h:%p');
  const args = ['-o', 'ControlMaster=auto', '-o', 'ControlPath=' + socketPath, '-tt', '--', host];
  if (remoteCmd) args.push(remoteCmd);

  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
} else {
  const defaultShell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const child = spawn(defaultShell, process.platform === 'win32' ? [] : ['-l'], { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
}
`;
  writeFileSync(join3(baseDir, "dsh-remote-shell.js"), runnerJs, "utf8");
  const bashLauncher = `#!/bin/sh
exec node "$(dirname "$0")/dsh-remote-shell.js" "$@"
`;
  const posixPath = join3(baseDir, "dsh-remote-shell");
  writeFileSync(posixPath, bashLauncher, "utf8");
  try {
    chmodSync2(posixPath, 493);
  } catch {
  }
  const cmdLauncher = `@echo off
node "%~dp0dsh-remote-shell.js" %*
`;
  writeFileSync(join3(baseDir, "dsh-remote-shell.cmd"), cmdLauncher, "utf8");
}

// src/interceptor.ts
var MAX_BODY_BYTES = 10 * 1024 * 1024;
async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buf);
  }
  const buffer = Buffer.concat(chunks);
  const text = buffer.toString("utf8");
  const payload = text.trim() ? JSON.parse(text) : {};
  return { buffer, payload };
}
function replayRequest(req, buffer) {
  return new Proxy(req, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return async function* () {
          yield buffer;
        };
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === "function") {
        return val.bind(target);
      }
      return val;
    }
  });
}
function getOriginalPrefixHandler(ctx, pathname) {
  const ws = ctx.webServer;
  if (!ws || !ws.prefixes) return null;
  let best = void 0;
  for (const [prefix, route] of ws.prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (best === void 0 || prefix.length > best.path.length) {
        best = route;
      }
    }
  }
  return best?.handler;
}
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}
function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value });
}
function writeError(res, status = 400, message = "operation failed") {
  writeJson(res, status, { ok: false, error: { code: "fs-error", message } });
}
function registerFsInterceptors(ctx) {
  const methods = ["fs.tree", "fs.read", "fs.write", "fs.search"];
  for (const method of methods) {
    ctx.effect(() => {
      return ctx.webServer.register({
        kind: "exact",
        path: `/sidebar/api/${method}`,
        handler: async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
            return;
          }
          let raw;
          try {
            raw = await readRawBody(req);
          } catch (e) {
            writeJson(res, 400, { ok: false, error: { code: "bad-request", message: e?.message || "invalid json" } });
            return;
          }
          const payload = raw.payload;
          try {
            let activeCwd = payload.cwd || "";
            if (!activeCwd && payload.sessionId && ctx.sessions) {
              const sess = ctx.sessions.get(payload.sessionId);
              activeCwd = sess?.header?.cwd || "";
            }
            if (!activeCwd && payload.path) {
              activeCwd = payload.path;
            }
            const remoteInfo = findRemoteWorkspaceMeta(activeCwd) || (payload.path ? findRemoteWorkspaceMeta(payload.path) : null);
            if (remoteInfo) {
              const { meta, anchorDir } = remoteInfo;
              if (meta.authType === "password" && !hasHostPassword(meta.host)) {
                writeJson(res, 401, {
                  ok: false,
                  needAuth: true,
                  host: meta.host,
                  error: { code: "need-auth", message: `\u8FDC\u7A0B\u4E3B\u673A ${meta.host} \u9700\u5BC6\u7801\u8BA4\u8BC1\uFF08\u5185\u5B58\u5BC6\u7801\u5DF2\u5931\u6548\uFF09` }
                });
                return;
              }
              const handleAuthError = (result) => {
                if (meta.authType === "password" && result.error && /认证失败|permission denied/i.test(result.error)) {
                  removeHostPassword(meta.host);
                  writeJson(res, 401, {
                    ok: false,
                    needAuth: true,
                    host: meta.host,
                    error: { code: "need-auth", message: `\u8FDC\u7A0B\u4E3B\u673A ${meta.host} \u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u5BC6\u7801` }
                  });
                  return true;
                }
                return false;
              };
              if (method === "fs.tree") {
                const targetLocal = payload.path || activeCwd || anchorDir;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteListDir(meta.host, remoteTarget, targetLocal);
                if (handleAuthError(result)) return;
                if (result.ok && result.data) {
                  writeOk(res, result.data);
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.read") {
                const targetLocal = payload.path;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteReadFile(meta.host, remoteTarget);
                if (handleAuthError(result)) return;
                if (result.ok) {
                  writeOk(res, result);
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.write") {
                const targetLocal = payload.path;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteWriteFile(meta.host, remoteTarget, payload.content || "");
                if (handleAuthError(result)) return;
                if (result.ok) {
                  writeOk(res, { ok: true });
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.search") {
                const targetLocal = activeCwd || anchorDir;
                const result = await remoteSearchFiles(meta.host, meta.remotePath, targetLocal, payload.query || "");
                if (handleAuthError(result)) return;
                if (result.ok) {
                  writeOk(res, { entries: result.entries, truncated: result.truncated });
                } else {
                  writeError(res, 400, result.error);
                }
              }
            } else {
              const originalHandler = getOriginalPrefixHandler(ctx, `/sidebar/api/${method}`);
              if (typeof originalHandler === "function") {
                await originalHandler(replayRequest(req, raw.buffer), res);
                return;
              }
              writeJson(res, 404, {
                ok: false,
                error: { code: "not-found", message: "No underlying handler registered for local workspace route" }
              });
            }
          } catch (err) {
            writeError(res, 400, err?.message || String(err));
          }
        }
      });
    }, `dsh-ssh: intercept /sidebar/api/${method}`);
  }
}

// src/tools.ts
import { posix as posix2 } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
function toCleanJson(val) {
  return JSON.parse(JSON.stringify(val));
}
function textRender(formatter) {
  return (args, value) => [{ type: "text", text: formatter(args, value) }];
}
function renderExec(v) {
  let text = String(v.stdout || "");
  if (v.stderr) {
    if (text && !text.endsWith("\n")) text += "\n";
    text += `[stderr]
${v.stderr}`;
  }
  if (!text) text = "(no output)";
  if (v.error && !text.includes(v.error)) {
    text += `
[error: ${v.error}]`;
  }
  if (v.exitCode !== void 0 && v.exitCode !== 0) {
    text += `
[exit code: ${v.exitCode}]`;
  }
  return text;
}
function resolveSessionCwd(ctx, exec) {
  try {
    if (exec?.agent?.session?.header?.cwd) return exec.agent.session.header.cwd;
    if (exec?.session?.header?.cwd) return exec.session.header.cwd;
    if (exec?.agent?.session?.cwd) return exec.agent.session.cwd;
    if (exec?.session?.cwd) return exec.session.cwd;
    if (exec?.agent?.cwd) return exec.agent.cwd;
  } catch {
  }
  return void 0;
}
function resolveContext(ctx, args, exec) {
  const sessionCwd = resolveSessionCwd(ctx, exec);
  const remoteInfo = findRemoteWorkspaceMeta(sessionCwd);
  const host = args.host || remoteInfo?.meta.host;
  const remoteRoot = remoteInfo?.meta.remotePath || "/";
  if (host && !isValidSshHost(host)) {
    return { host: null, remoteRoot, resolvedPath: null, error: `\u4E3B\u673A\u6821\u9A8C\u5931\u8D25\uFF1A\u4E3B\u673A "${host}" \u975E\u6CD5\u6216\u4E0D\u5728 ~/.ssh/config \u5217\u8868\u4E2D` };
  }
  let resolvedPath = args.path;
  if (resolvedPath !== void 0 && resolvedPath !== "") {
    if (!resolvedPath.startsWith("/") && !resolvedPath.startsWith("~")) {
      resolvedPath = `${remoteRoot.replace(/\/+$/, "")}/${resolvedPath}`;
    }
  } else {
    resolvedPath = remoteRoot;
  }
  if (remoteInfo && resolvedPath && !resolvedPath.startsWith("~")) {
    const cleanBase = posix2.normalize(remoteRoot.replace(/\\/g, "/"));
    const normTarget = posix2.normalize(resolvedPath.replace(/\\/g, "/"));
    if (cleanBase !== "/" && !normTarget.startsWith(cleanBase.endsWith("/") ? cleanBase : cleanBase + "/") && normTarget !== cleanBase) {
      return { host, remoteRoot, resolvedPath: null, error: `\u8DEF\u5F84\u904D\u5386\u62E6\u622A\uFF1A\u7981\u6B62\u8BBF\u95EE\u8D85\u51FA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u76EE\u5F55\u7684\u8DEF\u5F84: "${resolvedPath}"` };
    }
    resolvedPath = normTarget;
  }
  return { host, remoteRoot, resolvedPath, isRemoteWorkspace: !!remoteInfo, error: null };
}
function checkToolAuth(ctx, host, exec) {
  const sessionCwd = resolveSessionCwd(ctx, exec);
  const remoteInfo = findRemoteWorkspaceMeta(sessionCwd);
  if (remoteInfo && remoteInfo.meta.host === host && remoteInfo.meta.authType === "password") {
    if (!hasHostPassword(host)) {
      return {
        ok: false,
        needAuth: true,
        host,
        error: `\u8FDC\u7A0B\u4E3B\u673A ${host} \u5185\u5B58\u5BC6\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728\u7F51\u9875\u7AEF\u5F39\u51FA\u7684\u5BC6\u7801\u6846\u4E2D\u786E\u8BA4\u540E\u91CD\u8BD5\u3002`
      };
    }
  }
  return null;
}
function registerTools(ctx) {
  const register = (tool) => ctx.tools.register(defineTool(tool));
  register({
    name: "remote_ssh_hosts",
    description: "\u5217\u51FA\u5F53\u524D\u4ECE ~/.ssh/config \u4E2D\u53D1\u73B0\u7684\u6240\u6709\u53EF\u7528\u8FDC\u7A0B\u4E3B\u673A\u914D\u7F6E\uFF0C\u4EE5\u53CA\u5F53\u524D\u4F1A\u8BDD\u7ED1\u5B9A\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u72B6\u6001\u3002",
    parameters: {},
    output: {
      schema: { type: "json" },
      render: textRender((_, v) => JSON.stringify(v, null, 2))
    },
    execute: async (_args, exec) => {
      const hosts = parseSshConfig();
      const sessionCwd = resolveSessionCwd(ctx, exec);
      const info = findRemoteWorkspaceMeta(sessionCwd);
      return toCleanJson({
        hosts,
        currentRemote: info ? info.meta : null
      });
    }
  });
  register({
    name: "remote_ssh_exec",
    description: "\u5728\u8FDC\u7A0B SSH \u4E3B\u673A\u4E0A\u6267\u884C Shell \u547D\u4EE4\u3002\u5982\u679C\u5728\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u4E2D\uFF0C\u53EF\u514D\u586B host \u5E76\u81EA\u52A8\u5728\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u76EE\u5F55\u4E0B\u6267\u884C\u3002",
    parameters: {
      command: { type: "string", required: true, description: "\u8981\u5728\u8FDC\u7A0B\u4E3B\u673A\u4E0A\u6267\u884C\u7684 Shell \u547D\u4EE4" },
      host: { type: "string", description: "\u53EF\u9009\uFF0C~/.ssh/config \u4E2D\u7684\u4E3B\u673A\u522B\u540D\uFF08\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u4F1A\u8BDD\u4E2D\u81EA\u52A8\u83B7\u53D6\uFF09" },
      cwd: { type: "string", description: "\u53EF\u9009\uFF0C\u6267\u884C\u547D\u4EE4\u7684\u5DE5\u4F5C\u76EE\u5F55\uFF08\u9ED8\u8BA4\u81EA\u52A8\u4F7F\u7528\u5F53\u524D\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\uFF09" }
    },
    output: {
      schema: { type: "json" },
      render: textRender((_, v) => renderExec(v))
    },
    execute: async (args, exec) => {
      const { host, remoteRoot, error: ctxErr } = resolveContext(ctx, args, exec);
      if (ctxErr) {
        return toCleanJson({
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: ctxErr,
          error: ctxErr
        });
      }
      if (!host) {
        return toCleanJson({
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002\u8BF7\u63D0\u4F9B host \u53C2\u6570\uFF08\u5982 remote_ssh_hosts \u4E2D\u5217\u51FA\u7684\u4E3B\u673A\uFF09\u3002",
          error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A"
        });
      }
      const authErr = checkToolAuth(ctx, host, exec);
      if (authErr) return toCleanJson(authErr);
      const execDir = args.cwd || remoteRoot;
      let cmd = String(args.command || "").trim();
      if (execDir) {
        cmd = `cd ${shellQuote(execDir)} 2>/dev/null; ${cmd}`;
      }
      const r = await runSsh(host, cmd);
      return toCleanJson({
        ok: r.ok,
        exitCode: r.exitCode ?? (r.ok ? 0 : 1),
        stdout: r.stdout || "",
        stderr: r.stderr || "",
        error: r.error || null
      });
    }
  });
  register({
    name: "remote_ssh_read",
    description: "\u8BFB\u53D6\u8FDC\u7A0B\u4E3B\u673A\u4E0A\u7684\u6587\u4EF6\u6587\u672C\u5185\u5BB9\u3002",
    parameters: {
      path: { type: "string", required: true, description: "\u8FDC\u7A0B\u6587\u4EF6\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u6216\u76F8\u5BF9\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u7684\u76F8\u5BF9\u8DEF\u5F84\uFF09" },
      host: { type: "string", description: "\u53EF\u9009\uFF0C~/.ssh/config \u4E2D\u7684\u4E3B\u673A\u522B\u540D" }
    },
    output: {
      schema: { type: "json" },
      render: textRender((_, v) => {
        if (!v.ok) return v.error || "\u8BFB\u53D6\u5931\u8D25";
        return v.content || "(\u7A7A\u6587\u4EF6)";
      })
    },
    execute: async (args, exec) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec);
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr });
      if (!host) return toCleanJson({ ok: false, error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A" });
      if (!resolvedPath) return toCleanJson({ ok: false, error: "path \u4E0D\u80FD\u4E3A\u7A7A" });
      const authErr = checkToolAuth(ctx, host, exec);
      if (authErr) return toCleanJson(authErr);
      const r = await remoteReadFile(host, resolvedPath);
      if (!r.ok) return toCleanJson({ ok: false, error: r.error || "\u8BFB\u53D6\u5931\u8D25" });
      return toCleanJson({
        ok: true,
        path: resolvedPath,
        kind: r.kind || "text",
        content: r.content || "",
        size: r.size || 0,
        truncated: Boolean(r.truncated)
      });
    }
  });
  register({
    name: "remote_ssh_write",
    description: "\u5728\u8FDC\u7A0B\u4E3B\u673A\u4E0A\u521B\u5EFA\u6216\u8986\u76D6\u5199\u5165\u6587\u4EF6\u5185\u5BB9\u3002",
    parameters: {
      path: { type: "string", required: true, description: "\u8FDC\u7A0B\u6587\u4EF6\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u6216\u76F8\u5BF9\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u7684\u76F8\u5BF9\u8DEF\u5F84\uFF09" },
      content: { type: "string", required: true, description: "\u8981\u5199\u5165\u7684\u5B8C\u6574\u6587\u672C\u5185\u5BB9" },
      host: { type: "string", description: "\u53EF\u9009\uFF0C~/.ssh/config \u4E2D\u7684\u4E3B\u673A\u522B\u540D" }
    },
    output: {
      schema: { type: "json" },
      render: textRender((_, v) => v.ok ? "\u5199\u5165\u6210\u529F" : v.error || "\u5199\u5165\u5931\u8D25")
    },
    execute: async (args, exec) => {
      const { host, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec);
      if (ctxErr) return toCleanJson({ ok: false, error: ctxErr });
      if (!host) return toCleanJson({ ok: false, error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A" });
      if (!resolvedPath) return toCleanJson({ ok: false, error: "path \u4E0D\u80FD\u4E3A\u7A7A" });
      const authErr = checkToolAuth(ctx, host, exec);
      if (authErr) return toCleanJson(authErr);
      const r = await remoteWriteFile(host, resolvedPath, args.content ?? "");
      return toCleanJson({
        ok: r.ok,
        error: r.error || null
      });
    }
  });
}

// src/api.ts
var MAX_BODY_BYTES2 = 1024 * 1024;
async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES2) throw new Error("Body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function registerApiRoutes(ctx) {
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: "prefix",
      path: "/dsh-ssh/api",
      handler: async (req, res) => {
        const url = new URL(req.url || "/", "http://dsh.internal");
        const method = url.pathname.slice("/dsh-ssh/api/".length).replace(/\/+$/, "");
        try {
          if (method === "hosts") {
            const hosts = parseSshConfig();
            sendJson(res, 200, { ok: true, hosts });
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          const body = await readJson(req);
          if (body.host && !isValidSshHost(body.host)) {
            sendJson(res, 400, { ok: false, error: `\u975E\u6CD5\u6216\u4E0D\u5728 ~/.ssh/config \u5217\u8868\u4E2D\u7684\u4E3B\u673A\u540D: "${body.host}"` });
            return;
          }
          if (method === "auth-submit") {
            if (!body.host || !body.password) {
              sendJson(res, 400, { ok: false, error: "host and password are required" });
              return;
            }
            const r = await testSshConnection(body.host, body.password);
            if (r.ok) {
              setHostPassword(body.host, body.password);
              sendJson(res, 200, { ok: true, message: "\u8BA4\u8BC1\u6210\u529F" });
            } else {
              sendJson(res, 400, { ok: false, error: r.message || "\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25" });
            }
            return;
          }
          if (method === "test") {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: "host is required" });
              return;
            }
            const r = await testSshConnection(body.host, body.password);
            sendJson(res, 200, r);
            return;
          }
          if (method === "create-workspace") {
            if (!body.host || !body.remotePath) {
              sendJson(res, 400, { ok: false, error: "host and remotePath are required" });
              return;
            }
            const r = await createRemoteWorkspace(
              ctx.workspaceRegistry,
              body.host,
              body.remotePath,
              body.title,
              body.authType,
              body.password
            );
            sendJson(res, r.ok ? 200 : 400, r);
            return;
          }
          sendJson(res, 404, { ok: false, error: "Unknown API method: " + method });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err?.message || String(err) });
        }
      }
    });
  }, "dsh-ssh: /dsh-ssh/api prefix route");
}

// src/index.ts
var name = "dsh-ssh";
var inject = ["webServer", "tools", "workspaceRegistry"];
function apply(ctx) {
  ensureShellWrapper();
  hookWorkspaceRegistryDeletion(ctx);
  registerFsInterceptors(ctx);
  registerTools(ctx);
  registerApiRoutes(ctx);
  ctx.logger?.info("[dsh-ssh] Concise Remote-SSH plugin loaded successfully.");
}
var index_default = {
  name,
  inject,
  apply
};
export {
  apply,
  createRemoteWorkspace,
  index_default as default,
  deleteRemoteWorkspace,
  ensureShellWrapper,
  findRemoteWorkspaceMeta,
  getBaseDir,
  getHostPassword,
  getWorkspacesDir,
  hasHostPassword,
  hookWorkspaceRegistryDeletion,
  inject,
  invalidateCache,
  isValidSshHost,
  localToRemotePath,
  name,
  parseSshConfig,
  registerFsInterceptors,
  registerTools,
  remoteListDir,
  remoteReadFile,
  remoteSearchFiles,
  remoteWriteFile,
  removeHostPassword,
  runSsh,
  setHostPassword,
  shellQuote,
  testSshConnection
};
