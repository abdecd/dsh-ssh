// src/workspace.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
function getBaseDir() {
  const dir = join(homedir(), ".dsh", "dsh-ssh");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function getWorkspacesDir() {
  const dir = join(getBaseDir(), "workspaces");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function findRemoteWorkspaceMeta(startPath) {
  if (!startPath) return null;
  let current = startPath;
  const root = dirname(current);
  while (current && current !== root) {
    const metaPath = join(current, ".remote-ssh.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
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
  const normLocal = localPath.replace(/\\/g, "/");
  const normAnchor = anchorDir.replace(/\\/g, "/");
  let rel = "";
  if (normLocal.toLowerCase().startsWith(normAnchor.toLowerCase())) {
    rel = normLocal.slice(normAnchor.length);
  } else {
    rel = normLocal.replace(/^[A-Za-z]:/, "").replace(/^\/+/, "");
  }
  rel = rel.replace(/^\/+/, "");
  if (!rel) return remoteRoot;
  const cleanBase = remoteRoot.replace(/\/+$/, "");
  return `${cleanBase}/${rel}`;
}
async function createRemoteWorkspace(workspaceRegistry, host, remotePath, customTitle) {
  try {
    const id = "ws-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const anchorDir = join(getWorkspacesDir(), id);
    mkdirSync(anchorDir, { recursive: true });
    const cleanRemote = remotePath.trim().replace(/\/+$/, "") || "/";
    const folderName = basename(cleanRemote) || cleanRemote;
    const title = customTitle || `${folderName} (${host})`;
    const meta = {
      host,
      remotePath: cleanRemote,
      title,
      createdAt: Date.now()
    };
    writeFileSync(join(anchorDir, ".remote-ssh.json"), JSON.stringify(meta, null, 2), "utf8");
    const agentsMd = [
      `# \u{1F310} Remote Workspace: ${title}`,
      "",
      `This directory is a local anchor for remote SSH host: \`${host}\``,
      `Remote path: \`${cleanRemote}\``,
      "",
      "All sidebar file views/edits and integrated terminal sessions automatically connect to the remote host.",
      "AI models must use `remote_ssh_*` tools (`remote_ssh_exec`, `remote_ssh_read`, `remote_ssh_write`) to directly execute commands and read/write remote files."
    ].join("\n");
    writeFileSync(join(anchorDir, "AGENTS.md"), agentsMd, "utf8");
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
    if (workspaceRegistry && typeof workspaceRegistry.resolveByPath === "function") {
      const entity = await workspaceRegistry.resolveByPath(anchorDir);
      if (entity && typeof workspaceRegistry.delete === "function") {
        await workspaceRegistry.delete(entity.id);
      }
    }
    if (existsSync(anchorDir)) {
      rmSync(anchorDir, { recursive: true, force: true });
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
        if (existsSync(anchorToRemove)) {
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

if (meta && meta.host) {
  const host = meta.host;
  const remotePath = meta.remotePath;
  let remoteCmd = undefined;
  if (remotePath) {
    remoteCmd = 'cd ' + JSON.stringify(remotePath) + ' 2>/dev/null; exec \${SHELL:-/bin/bash} -l';
  }
  const args = ['-tt', host];
  if (remoteCmd) args.push(remoteCmd);

  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
} else {
  const defaultShell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const child = spawn(defaultShell, process.platform === 'win32' ? [] : ['-l'], { stdio: 'inherit' });
  child.on('exit', (c) => process.exit(c ?? 0));
}
`;
  writeFileSync(join(baseDir, "dsh-remote-shell.js"), runnerJs, "utf8");
  const bashLauncher = `#!/bin/sh
exec node "$(dirname "$0")/dsh-remote-shell.js" "$@"
`;
  const posixPath = join(baseDir, "dsh-remote-shell");
  writeFileSync(posixPath, bashLauncher, "utf8");
  try {
    chmodSync(posixPath, 493);
  } catch {
  }
  const cmdLauncher = `@echo off
node "%~dp0dsh-remote-shell.js" %*
`;
  writeFileSync(join(baseDir, "dsh-remote-shell.cmd"), cmdLauncher, "utf8");
}

// src/interceptor.ts
import { opendir, stat, readFile, writeFile, rename, mkdir, rm, readdir } from "node:fs/promises";
import { join as join3, dirname as dirname2 } from "node:path";
import { homedir as homedir3 } from "node:os";

// src/connection.ts
import { spawn } from "node:child_process";
import { mkdirSync as mkdirSync2, existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var MAX_BYTES = 10 * 1024 * 1024;
var CACHE_TTL_MS = 5e3;
function getSocketDir() {
  const dir = join2(homedir2(), ".dsh", "dsh-ssh", "sockets");
  if (!existsSync2(dir)) {
    mkdirSync2(dir, { recursive: true });
  }
  return dir;
}
function shellQuote(p) {
  if (!p) return "''";
  return "'" + String(p).replace(/'/g, "'\\''") + "'";
}
function translateSshError(text) {
  const t = String(text || "");
  if (/permission denied \(publickey/i.test(t)) {
    return "SSH \u516C\u94A5\u8BA4\u8BC1\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u79C1\u94A5\u914D\u7F6E\u6216\u76EE\u6807\u4E3B\u673A\u7684 ~/.ssh/authorized_keys \u4E2D\u5DF2\u6DFB\u52A0\u5BF9\u5E94\u516C\u94A5\u3002";
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
  const socketDir = getSocketDir();
  const socketPath = join2(socketDir, "%r@%h:%p");
  const args = [
    "-o",
    "BatchMode=yes",
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
    "ControlPersist=10m",
    host,
    command
  ];
  return new Promise((resolve) => {
    let stdoutText = "";
    let stderrText = "";
    let resolved = false;
    const child = spawn("ssh", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGKILL");
        } catch {
        }
        resolve({
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
        resolve({
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
        resolve({
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
var listCache = /* @__PURE__ */ new Map();
var readCache = /* @__PURE__ */ new Map();
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
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      ok: true,
      data: {
        path: localDisplayPath,
        entries: cached.data.entries.map((e) => ({
          ...e,
          path: localDisplayPath.endsWith("/") || localDisplayPath.endsWith("\\") ? `${localDisplayPath}${e.name}` : `${localDisplayPath}/${e.name}`
        })),
        truncated: cached.data.truncated
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
  listCache.set(cacheKey, { data: listing, timestamp: Date.now() });
  return { ok: true, data: listing };
}
async function remoteReadFile(host, remotePath) {
  const cacheKey = `${host}|${remotePath}`;
  const cached = readCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
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
  readCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
async function remoteWriteFile(host, remotePath, content) {
  const b64 = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(String(content), "utf8").toString("base64");
  const dirname3 = remotePath.split("/").slice(0, -1).join("/") || ".";
  const script = `mkdir -p ${shellQuote(dirname3)} && base64 -d > ${shellQuote(remotePath)}`;
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
async function testSshConnection(host) {
  const r = await runSsh(host, 'echo "OK"', void 0, 8e3);
  if (r.ok && r.stdout.includes("OK")) {
    return { ok: true, message: "\u8FDE\u63A5\u6210\u529F\uFF01" };
  }
  return { ok: false, message: r.error || r.stderr || "\u8FDE\u63A5\u5931\u8D25" };
}

// src/interceptor.ts
var MAX_BODY_BYTES = 10 * 1024 * 1024;
async function readJsonBody(req) {
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
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
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
async function localListDir(targetPath) {
  const dir = targetPath || homedir3();
  const level = await opendir(dir);
  const entries = [];
  for await (const dirent of level) {
    if (entries.length >= 1e3) break;
    const isDir = dirent.isDirectory();
    const isSymlink = dirent.isSymbolicLink();
    entries.push({
      name: dirent.name,
      path: join3(dir, dirent.name),
      isDir,
      isSymlink,
      broken: false,
      hidden: dirent.name.startsWith(".")
    });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
  });
  return { path: dir, entries, truncated: entries.length >= 1e3 };
}
async function localReadText(filePath) {
  const s = await stat(filePath);
  if (s.isDirectory()) throw new Error("is a directory");
  const buffer = await readFile(filePath);
  const probe = buffer.subarray(0, Math.min(buffer.length, 8e3));
  if (probe.includes(0)) {
    return {
      kind: "binary",
      size: s.size,
      head: probe.subarray(0, Math.min(probe.length, 4096)).toString("base64"),
      truncated: false
    };
  }
  return {
    kind: "text",
    content: buffer.toString("utf8"),
    truncated: false
  };
}
async function localWriteText(filePath, content) {
  const tmp = `${filePath}.dsh-ssh-tmp-${process.pid}`;
  try {
    await mkdir(dirname2(filePath), { recursive: true });
    await writeFile(tmp, content, "utf8");
    await rename(tmp, filePath);
    return { ok: true };
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {
    });
    throw err;
  }
}
async function localSearch(rootDir, query) {
  if (!query) return { entries: [], truncated: false };
  const q = query.toLowerCase();
  const entries = [];
  async function walk(dir, depth) {
    if (depth > 6 || entries.length >= 300) return;
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.toLowerCase().includes(q)) {
          entries.push({ path: join3(dir, item.name), isDir: item.isDirectory() });
          if (entries.length >= 300) return;
        }
        if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") {
          await walk(join3(dir, item.name), depth + 1);
        }
      }
    } catch {
    }
  }
  await walk(rootDir, 0);
  return { entries, truncated: entries.length >= 300 };
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
          let payload = {};
          try {
            payload = await readJsonBody(req);
          } catch (e) {
            writeJson(res, 400, { ok: false, error: { code: "bad-request", message: e?.message || "invalid json" } });
            return;
          }
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
              if (method === "fs.tree") {
                const targetLocal = payload.path || activeCwd || anchorDir;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteListDir(meta.host, remoteTarget, targetLocal);
                if (result.ok && result.data) {
                  writeOk(res, result.data);
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.read") {
                const targetLocal = payload.path;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteReadFile(meta.host, remoteTarget);
                if (result.ok) {
                  writeOk(res, result);
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.write") {
                const targetLocal = payload.path;
                const remoteTarget = localToRemotePath(targetLocal, anchorDir, meta.remotePath);
                const result = await remoteWriteFile(meta.host, remoteTarget, payload.content || "");
                if (result.ok) {
                  writeOk(res, { ok: true });
                } else {
                  writeError(res, 400, result.error);
                }
              } else if (method === "fs.search") {
                const targetLocal = activeCwd || anchorDir;
                const result = await remoteSearchFiles(meta.host, meta.remotePath, targetLocal, payload.query || "");
                if (result.ok) {
                  writeOk(res, { entries: result.entries, truncated: result.truncated });
                } else {
                  writeError(res, 400, result.error);
                }
              }
            } else {
              if (method === "fs.tree") {
                const target = payload.path || activeCwd;
                const result = await localListDir(target);
                writeOk(res, result);
              } else if (method === "fs.read") {
                const result = await localReadText(payload.path);
                writeOk(res, result);
              } else if (method === "fs.write") {
                const result = await localWriteText(payload.path, payload.content || "");
                writeOk(res, result);
              } else if (method === "fs.search") {
                const target = activeCwd || homedir3();
                const result = await localSearch(target, payload.query || "");
                writeOk(res, result);
              }
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
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/config.ts
import { readFileSync as readFileSync2, existsSync as existsSync3 } from "node:fs";
import { join as join4 } from "node:path";
import { homedir as homedir4 } from "node:os";
function parseSshConfig() {
  const configPath = join4(homedir4(), ".ssh", "config");
  if (!existsSync3(configPath)) {
    return [];
  }
  try {
    const content = readFileSync2(configPath, "utf8");
    const lines = content.split(/\r?\n/);
    const hosts = [];
    let current = null;
    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf("#");
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const key = parts[0]?.toLowerCase();
      const value = parts.slice(1).join(" ").trim();
      if (key === "host") {
        const aliases = parts.slice(1).filter((a) => a && !a.includes("*") && !a.includes("?"));
        for (const alias of aliases) {
          current = { host: alias };
          hosts.push(current);
        }
      } else if (current) {
        if (key === "hostname") current.hostName = value;
        else if (key === "user") current.user = value;
        else if (key === "port") current.port = parseInt(value, 10) || 22;
        else if (key === "identityfile") current.identityFile = value.replace(/^~(?=$|\/|\\)/, homedir4());
        else if (key === "proxyjump") current.proxyJump = value;
      }
    }
    return hosts;
  } catch (err) {
    console.error("[dsh-ssh] Failed to read ~/.ssh/config:", err);
    return [];
  }
}

// src/tools.ts
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
  let resolvedPath = args.path;
  if (resolvedPath !== void 0 && resolvedPath !== "") {
    if (!resolvedPath.startsWith("/") && !resolvedPath.startsWith("~")) {
      resolvedPath = `${remoteRoot.replace(/\/+$/, "")}/${resolvedPath}`;
    }
  } else {
    resolvedPath = remoteRoot;
  }
  return { host, remoteRoot, resolvedPath, isRemoteWorkspace: !!remoteInfo };
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
      const { host, remoteRoot } = resolveContext(ctx, args, exec);
      if (!host) {
        return toCleanJson({
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002\u8BF7\u63D0\u4F9B host \u53C2\u6570\uFF08\u5982 remote_ssh_hosts \u4E2D\u5217\u51FA\u7684\u4E3B\u673A\uFF09\u3002",
          error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A"
        });
      }
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
      const { host, resolvedPath } = resolveContext(ctx, args, exec);
      if (!host) return toCleanJson({ ok: false, error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A" });
      if (!resolvedPath) return toCleanJson({ ok: false, error: "path \u4E0D\u80FD\u4E3A\u7A7A" });
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
      const { host, resolvedPath } = resolveContext(ctx, args, exec);
      if (!host) return toCleanJson({ ok: false, error: "\u672A\u6307\u5B9A host\uFF0C\u4E14\u5F53\u524D\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A" });
      if (!resolvedPath) return toCleanJson({ ok: false, error: "path \u4E0D\u80FD\u4E3A\u7A7A" });
      const r = await remoteWriteFile(host, resolvedPath, args.content ?? "");
      return toCleanJson({
        ok: r.ok,
        error: r.error || null
      });
    }
  });
}

// src/api.ts
import { readdirSync as readdirSync2, existsSync as existsSync4, readFileSync as readFileSync3 } from "node:fs";
import { join as join5 } from "node:path";
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
          if (method === "workspaces") {
            const wsDir = getWorkspacesDir();
            const list = [];
            if (existsSync4(wsDir)) {
              for (const name2 of readdirSync2(wsDir)) {
                const sub = join5(wsDir, name2);
                const jsonPath = join5(sub, ".remote-ssh.json");
                if (existsSync4(jsonPath)) {
                  try {
                    const meta = JSON.parse(readFileSync3(jsonPath, "utf8"));
                    list.push({ anchorDir: sub, meta });
                  } catch {
                  }
                }
              }
            }
            sendJson(res, 200, { ok: true, workspaces: list });
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          const body = await readJson(req);
          if (method === "test") {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: "host is required" });
              return;
            }
            const r = await testSshConnection(body.host);
            sendJson(res, 200, r);
            return;
          }
          if (method === "browse") {
            if (!body.host) {
              sendJson(res, 400, { ok: false, error: "host is required" });
              return;
            }
            const targetPath = body.path || "~";
            const r = await remoteListDir(body.host, targetPath, targetPath);
            if (r.ok && r.data) {
              const dirs = r.data.entries.filter((e) => e.isDir).map((e) => e.name);
              sendJson(res, 200, { ok: true, currentPath: targetPath, dirs });
            } else {
              sendJson(res, 400, { ok: false, error: r.error || "Failed to list directory" });
            }
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
              body.title
            );
            sendJson(res, r.ok ? 200 : 400, r);
            return;
          }
          if (method === "delete-workspace") {
            if (!body.anchorDir) {
              sendJson(res, 400, { ok: false, error: "anchorDir is required" });
              return;
            }
            const r = await deleteRemoteWorkspace(ctx.workspaceRegistry, body.anchorDir);
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
  getWorkspacesDir,
  hookWorkspaceRegistryDeletion,
  inject,
  invalidateCache,
  localToRemotePath,
  name,
  parseSshConfig,
  registerFsInterceptors,
  registerTools,
  remoteListDir,
  remoteReadFile,
  remoteSearchFiles,
  remoteWriteFile,
  runSsh,
  shellQuote,
  testSshConnection
};
