// src/workspace.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync, rmSync, chmodSync as chmodSync2, realpathSync } from "node:fs";
import { join as join3, basename, resolve, sep, posix } from "node:path";
import { homedir as homedir3 } from "node:os";

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
import { spawn } from "node:child_process";
import { mkdirSync, existsSync as existsSync2, chmodSync } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var MAX_STDOUT_BYTES = 16 * 1024 * 1024;
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
async function closeSshConnection(host) {
  removeHostPassword(host);
  if (!isValidSshHost(host)) return;
  const socketDir = getSocketDir();
  const socketPath = join2(socketDir, "%r@%h:%p");
  await new Promise((resolve2) => {
    const child = spawn("ssh", ["-O", "exit", "-o", `ControlPath=${socketPath}`, "--", host], {
      stdio: "ignore"
    });
    child.on("close", () => resolve2());
    child.on("error", () => resolve2());
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      resolve2();
    }, 3e3);
  });
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
function shellCd(targetPath) {
  const p = String(targetPath || "").trim();
  if (!p || p === "~" || p === "~/" || p === "~\\") {
    return 'cd "$HOME" 2>/dev/null || cd ~ 2>/dev/null || cd';
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    const sub = p.slice(2);
    return `cd "$HOME"/${shellQuote(sub)} 2>/dev/null`;
  }
  return `cd ${shellQuote(p)} 2>/dev/null`;
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
async function runSsh(host, command, stdinData, timeoutMs = 3e4, options = {}) {
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
  const password = options.password !== void 0 ? options.password : getHostPassword(host);
  const baseArgs = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ClearAllForwardings=yes"
  ];
  if (options.disableConnectionReuse) {
    baseArgs.push("-o", "ControlMaster=no", "-o", "ControlPath=none");
  } else {
    baseArgs.push(
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${socketPath}`,
      "-o",
      "ControlPersist=10m"
    );
  }
  if (options.passwordOnly) {
    baseArgs.push(
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "PreferredAuthentications=password",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "GSSAPIAuthentication=no",
      "-o",
      "HostbasedAuthentication=no"
    );
  }
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
    let stdoutTruncated = false;
    let resolved = false;
    const child = spawn(bin, finalArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env
    });
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try {
        child.stdin?.destroy();
      } catch {
      }
      try {
        child.stdout?.destroy();
      } catch {
      }
      try {
        child.stderr?.destroy();
      } catch {
      }
      resolve2(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      finish({
        ok: false,
        exitCode: -1,
        stdout: stdoutText,
        stderr: stderrText,
        error: `SSH \u547D\u4EE4\u6267\u884C\u8D85\u65F6 (${timeoutMs / 1e3}s)`,
        stdoutTruncated
      });
    }, timeoutMs);
    if (child.stdin) {
      child.stdin.on("error", (_err) => {
      });
    }
    if (stdinData !== void 0 && child.stdin) {
      try {
        child.stdin.write(stdinData, () => {
          try {
            child.stdin?.end();
          } catch {
          }
        });
      } catch {
      }
    }
    child.stdout?.on("data", (chunk) => {
      if (stdoutText.length < MAX_STDOUT_BYTES) {
        const remain = MAX_STDOUT_BYTES - stdoutText.length;
        if (chunk.length > remain) {
          stdoutText += chunk.subarray(0, remain).toString("utf8");
          stdoutTruncated = true;
        } else {
          stdoutText += chunk.toString("utf8");
        }
      } else {
        stdoutTruncated = true;
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderrText.length < 512 * 1024) {
        stderrText += chunk.toString("utf8");
      }
    });
    child.on("error", (err) => {
      finish({
        ok: false,
        exitCode: -1,
        stdout: stdoutText,
        stderr: stderrText,
        error: "SSH \u8FDB\u7A0B\u542F\u52A8\u5931\u8D25: " + err.message,
        stdoutTruncated
      });
    });
    child.on("close", (code) => {
      const exitCode = code ?? 0;
      const ok = exitCode === 0;
      const errHint = !ok ? translateSshError(stderrText) || `SSH \u9000\u51FA\u7801: ${exitCode}` : void 0;
      finish({
        ok,
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        error: errHint,
        stdoutTruncated
      });
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
  const script = `( ${shellCd(remotePath)} || { echo '__DSH_ERR_CD__'; exit 1; }; find . -maxdepth 1 -mindepth 1 -printf '%Y\\t%f\\t%s\\n' 2>/dev/null || ls -1ap 2>/dev/null )`;
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
  const script = `( [ -f ${shellQuote(remotePath)} ] || { echo '__DSH_ERR_NOT_FOUND__'; exit 1; }; SIZE=$(wc -c < ${shellQuote(remotePath)} 2>/dev/null || stat -c %s ${shellQuote(remotePath)} 2>/dev/null || echo 0); if [ "$SIZE" -gt ${MAX_FILE_BYTES} ]; then echo "__DSH_ERR_TOO_LARGE__:$SIZE"; exit 1; fi; echo "__DSH_FILE_SIZE__:$SIZE"; base64 < ${shellQuote(remotePath)} 2>/dev/null; echo ""; echo "__DSH_READ_EOF__"; )`;
  const r = await runSsh(host, script);
  if (!r.ok) {
    if (r.stdout.includes("__DSH_ERR_NOT_FOUND__")) {
      return { ok: false, error: `\u8FDC\u7A0B\u6587\u4EF6\u4E0D\u5B58\u5728: ${remotePath}` };
    }
    if (r.stdout.includes("__DSH_ERR_TOO_LARGE__")) {
      const match = r.stdout.match(/__DSH_ERR_TOO_LARGE__:(\d+)/);
      const sizeStr = match ? ` (${Math.round(Number(match[1]) / (1024 * 1024))}MB)` : "";
      return { ok: false, error: `\u8FDC\u7A0B\u6587\u4EF6\u8FC7\u5927${sizeStr}\uFF0C\u8D85\u8FC7 10MB \u9650\u5236\u3002\u4E3A\u9632\u6B62\u622A\u65AD\u5BFC\u81F4\u540E\u7EED\u4FDD\u5B58\u635F\u574F\u6587\u4EF6\uFF0C\u5DF2\u62D2\u7EDD\u8BFB\u53D6\u3002` };
    }
    return { ok: false, error: r.error || r.stderr || "\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25" };
  }
  if (!r.stdout.includes("__DSH_READ_EOF__") || r.stdoutTruncated) {
    return { ok: false, error: "\u8FDC\u7A0B\u6587\u4EF6\u8BFB\u53D6\u672A\u5B8C\u6210\uFF08\u6570\u636E\u4F20\u8F93\u4E2D\u65AD\u6216\u8D85\u8FC7\u7F13\u51B2\u533A\u9650\u5236\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u89E3\u6790\u4EE5\u9632\u6587\u4EF6\u635F\u574F" };
  }
  const sizeMatch = r.stdout.match(/__DSH_FILE_SIZE__:(\d+)/);
  if (!sizeMatch) {
    return { ok: false, error: "\u672A\u80FD\u83B7\u53D6\u8FDC\u7A0B\u6587\u4EF6\u5927\u5C0F\u5143\u6570\u636E" };
  }
  const expectedSize = parseInt(sizeMatch[1], 10);
  const startIndex = r.stdout.indexOf(sizeMatch[0]) + sizeMatch[0].length;
  const endIndex = r.stdout.indexOf("__DSH_READ_EOF__");
  const rawB64 = r.stdout.slice(startIndex, endIndex).replace(/\s+/g, "");
  let buffer;
  try {
    buffer = Buffer.from(rawB64, "base64");
  } catch (e) {
    return { ok: false, error: "\u89E3\u7801\u8FDC\u7A0B\u6587\u4EF6\u5931\u8D25: " + String(e) };
  }
  if (buffer.length !== expectedSize) {
    return {
      ok: false,
      error: `\u8FDC\u7A0B\u6587\u4EF6\u5B8C\u6574\u6027\u6821\u9A8C\u5931\u8D25\uFF1A\u9884\u671F\u5927\u5C0F ${expectedSize} \u5B57\u8282\uFF0C\u5B9E\u9645\u63A5\u6536 ${buffer.length} \u5B57\u8282\u3002\u5DF2\u62D2\u7EDD\u8FD4\u56DE\u4EE5\u9632\u6B62\u635F\u574F\u6587\u4EF6\u3002`
    };
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
      truncated: false
    };
  } else {
    result = {
      ok: true,
      kind: "text",
      size: buffer.length,
      content: buffer.toString("utf8"),
      truncated: false
    };
  }
  setCacheItem(readCache, cacheKey, result);
  return result;
}
async function remoteWriteFile(host, remotePath, content) {
  const b64 = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(String(content), "utf8").toString("base64");
  const dirname2 = remotePath.split("/").slice(0, -1).join("/") || ".";
  const tmpPath = `${remotePath}.dsh-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const script = `mkdir -p ${shellQuote(dirname2)} && ( touch ${shellQuote(tmpPath)} 2>/dev/null && chmod 600 ${shellQuote(tmpPath)} 2>/dev/null && base64 -d > ${shellQuote(tmpPath)} && if [ -e ${shellQuote(remotePath)} ]; then chmod --reference=${shellQuote(remotePath)} ${shellQuote(tmpPath)} 2>/dev/null || { MODE=$(stat -c %a ${shellQuote(remotePath)} 2>/dev/null || stat -f %OLp ${shellQuote(remotePath)} 2>/dev/null || stat -f %Lp ${shellQuote(remotePath)} 2>/dev/null); [ -n "$MODE" ] && chmod "$MODE" ${shellQuote(tmpPath)} 2>/dev/null; }; else UM=$(umask 2>/dev/null || echo 077); CLEAN_UM=$(echo "$UM" | sed 's/^0*//' 2>/dev/null); [ -z "$CLEAN_UM" ] && CLEAN_UM="0"; MODE=$(printf '%03o' $(( 0666 & ~0$CLEAN_UM )) 2>/dev/null || echo 600); chmod "$MODE" ${shellQuote(tmpPath)} 2>/dev/null || chmod 600 ${shellQuote(tmpPath)} 2>/dev/null; fi && mv -f ${shellQuote(tmpPath)} ${shellQuote(remotePath)} ) || { rm -f ${shellQuote(tmpPath)} 2>/dev/null; exit 1; }`;
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
  const script = `( ${shellCd(remotePath)} && find . -maxdepth 5 -name ${shellQuote(q)} 2>/dev/null | head -n 300 )`;
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
  if (password !== void 0 && !password) {
    return { ok: false, message: "\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" };
  }
  const hasPassword = password !== void 0;
  const r = await runSsh(
    host,
    'echo "OK"',
    void 0,
    8e3,
    hasPassword ? { password, disableConnectionReuse: true, passwordOnly: true } : void 0
  );
  if (r.ok && r.stdout.includes("OK")) {
    return { ok: true, message: "\u8FDE\u63A5\u6210\u529F\uFF01" };
  }
  return { ok: false, message: r.error || r.stderr || "\u8FDE\u63A5\u5931\u8D25" };
}
async function remoteBrowseDirs(host, targetPath = "~") {
  const p = targetPath.trim() || "~";
  if (/[\r\n\0]/.test(p)) {
    return { ok: false, error: "\u975E\u6CD5\u8DEF\u5F84\u5B57\u7B26" };
  }
  const script = `( ${shellCd(p)} || { echo '__DSH_ERR_CD__'; exit 1; }; pwd -P; echo '__DSH_SEP__'; { find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\\n' 2>/dev/null || ls -1dp */ 2>/dev/null; } | sort -f | head -n 201 )`;
  const r = await runSsh(host, script, void 0, 8e3);
  if (!r.ok) {
    if (r.stdout.includes("__DSH_ERR_CD__")) {
      return { ok: false, error: `\u65E0\u6CD5\u8BBF\u95EE\u8BE5\u8FDC\u7A0B\u76EE\u5F55\uFF08\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u9650\uFF09: ${p}` };
    }
    return { ok: false, error: r.error || r.stderr || "\u8BFB\u53D6\u8FDC\u7A0B\u76EE\u5F55\u5931\u8D25" };
  }
  const parts = r.stdout.split("__DSH_SEP__");
  const absPath = parts[0]?.trim() || p;
  const rawLines = (parts[1] || "").split(/\r?\n/);
  const dirSet = /* @__PURE__ */ new Set();
  for (const line of rawLines) {
    let name2 = line.trim();
    if (!name2 || name2 === "." || name2 === ".." || name2 === "./") continue;
    if (name2.endsWith("/")) name2 = name2.slice(0, -1);
    if (name2.startsWith(".")) continue;
    dirSet.add(name2);
  }
  const rawDirs = Array.from(dirSet);
  const truncated = rawDirs.length > 200;
  const dirs = rawDirs.slice(0, 200);
  return {
    ok: true,
    currentPath: absPath,
    dirs,
    truncated
  };
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
  try {
    const wsBaseDir = resolve(getWorkspacesDir());
    const prefixWithSep = wsBaseDir.endsWith(sep) ? wsBaseDir : wsBaseDir + sep;
    const target = resolve(startPath);
    let canon = target;
    try {
      canon = realpathSync(target);
    } catch {
    }
    if (!canon.startsWith(prefixWithSep) || canon === wsBaseDir) {
      return null;
    }
    const rel = posix.normalize(canon.slice(prefixWithSep.length).replace(/\\/g, "/"));
    const anchorName = rel.split("/")[0];
    if (!anchorName || anchorName === "." || anchorName === "..") {
      return null;
    }
    const anchorDir = join3(wsBaseDir, anchorName);
    const metaPath = join3(anchorDir, ".remote-ssh.json");
    if (!existsSync3(metaPath)) {
      return null;
    }
    const meta = JSON.parse(readFileSync2(metaPath, "utf8"));
    if (meta && meta.host && meta.remotePath && isValidSshHost(meta.host)) {
      return { meta, anchorDir };
    }
  } catch {
  }
  return null;
}
function localToRemotePath(localPath, anchorDir, remoteRoot) {
  if (!localPath) return remoteRoot;
  const normLocal = posix.normalize(localPath.replace(/\\/g, "/"));
  const normAnchor = posix.normalize(anchorDir.replace(/\\/g, "/"));
  const cleanBase = posix.normalize(remoteRoot.replace(/\\/g, "/"));
  if (normLocal === normAnchor) {
    return cleanBase;
  }
  let rel = "";
  const anchorWithSlash = normAnchor.endsWith("/") ? normAnchor : normAnchor + "/";
  if (normLocal.startsWith(anchorWithSlash)) {
    rel = normLocal.slice(anchorWithSlash.length);
  } else if (!normLocal.startsWith("/")) {
    rel = normLocal;
  } else {
    rel = posix.relative(normAnchor, normLocal);
  }
  if (!rel || rel === ".") return cleanBase;
  const candidate = posix.resolve(cleanBase, rel);
  const baseWithSlash = cleanBase.endsWith("/") ? cleanBase : cleanBase + "/";
  const isWithin = candidate === cleanBase || candidate.startsWith(baseWithSlash);
  if (!isWithin || rel.startsWith("../") || rel === "..") {
    throw new Error(`\u8DEF\u5F84\u904D\u5386\u62E6\u622A\uFF1A\u62D2\u7EDD\u8BBF\u95EE\u8D85\u51FA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u7684\u8DEF\u5F84 "${localPath}"`);
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
function tryCleanWorkspaceConnection(anchorDir) {
  try {
    const metaPath = join3(anchorDir, ".remote-ssh.json");
    if (existsSync3(metaPath)) {
      const meta = JSON.parse(readFileSync2(metaPath, "utf8"));
      if (meta && meta.host) {
        closeSshConnection(meta.host).catch(() => {
        });
      }
    }
  } catch {
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
      tryCleanWorkspaceConnection(target);
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
  const wsBaseDir = resolve(getWorkspacesDir());
  const prefixWithSep = wsBaseDir.endsWith(sep) ? wsBaseDir : wsBaseDir + sep;
  reg.delete = async function(id) {
    let anchorToRemove = null;
    try {
      const entity = typeof reg.get === "function" ? reg.get(id) : null;
      if (entity && entity.path) {
        const p = String(entity.path);
        const resolvedPath = resolve(p);
        let canon = resolvedPath;
        try {
          canon = realpathSync(resolvedPath);
        } catch {
        }
        if (canon.startsWith(prefixWithSep) && canon !== wsBaseDir) {
          anchorToRemove = resolvedPath;
        }
      }
    } catch {
    }
    const result = await originalDelete(id);
    if (anchorToRemove) {
      try {
        if (existsSync3(anchorToRemove)) {
          tryCleanWorkspaceConnection(anchorToRemove);
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
const os = require('os');
const { spawn } = require('child_process');

function shellQuote(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "'\\\\''") + "'";
}

function parseSshConfigHosts() {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(configPath)) return new Set();
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split(/\\r?\\n/);
    const hosts = new Set();
    for (const rawLine of lines) {
      const hashIdx = rawLine.indexOf('#');
      const line = (hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine).trim();
      if (!line) continue;
      const parts = line.split(/\\s+/);
      const key = parts[0] ? parts[0].toLowerCase() : '';
      if (key === 'host') {
        const aliases = parts.slice(1).filter((a) => a && !a.includes('*') && !a.includes('?') && !a.startsWith('-'));
        for (const a of aliases) hosts.add(a.toLowerCase());
      }
    }
    return hosts;
  } catch {
    return new Set();
  }
}

let meta = null;
try {
  const cur = process.cwd();
  const wsDir = path.resolve(path.join(os.homedir(), '.dsh', 'dsh-ssh', 'workspaces'));
  let canon = path.resolve(cur);
  try { canon = fs.realpathSync(canon); } catch {}

  const prefixWithSep = wsDir.endsWith(path.sep) ? wsDir : wsDir + path.sep;
  if (canon.startsWith(prefixWithSep) && canon !== wsDir) {
    const rel = path.relative(wsDir, canon);
    const anchorName = rel.split(path.sep)[0];
    if (anchorName && anchorName !== '.' && anchorName !== '..') {
      const anchorDir = path.join(wsDir, anchorName);
      const metaPath = path.join(anchorDir, '.remote-ssh.json');
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    }
  }
} catch {}

if (meta && meta.host && typeof meta.host === 'string') {
  const host = meta.host.trim();
  const validHosts = parseSshConfigHosts();
  if (!/^[a-zA-Z0-9_.-]+$/.test(host) || host.startsWith('-') || !validHosts.has(host.toLowerCase())) {
    console.error('[dsh-ssh] \u975E\u6CD5\u6216\u672A\u5728 ~/.ssh/config \u4E2D\u914D\u7F6E\u7684 SSH \u4E3B\u673A: ' + host);
    process.exit(1);
  }
  const remotePath = meta.remotePath;
  let remoteCmd = undefined;
  if (remotePath) {
    remoteCmd = 'cd ' + shellQuote(remotePath) + ' 2>/dev/null; exec \${SHELL:-/bin/bash} -l';
  }
  const socketPath = path.join(os.homedir(), '.dsh', 'dsh-ssh', 'sockets', '%r@%h:%p');
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
function isSafeRequest(req) {
  const headers = req.headers || {};
  const secFetchSite = headers["sec-fetch-site"];
  if (secFetchSite === "cross-site") {
    return false;
  }
  const ct = (headers["content-type"] || "").toLowerCase();
  if (ct.includes("form") || ct.includes("multipart") || ct.startsWith("text/") && !ct.includes("json")) {
    return false;
  }
  const origin = headers["origin"] || headers["referer"];
  if (!origin) {
    if (headers["sec-fetch-dest"] || headers["sec-fetch-mode"] || headers["sec-ch-ua"]) {
      return false;
    }
    const remoteAddr = String(req.socket?.remoteAddress || req.connection?.remoteAddress || "").trim();
    const isLoopback = !remoteAddr || remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
    return isLoopback;
  }
  try {
    const originUrl = new URL(origin);
    const hostHeader = String(headers["host"] || "").trim().toLowerCase();
    if (!hostHeader) return false;
    let expectedHost = hostHeader;
    let expectedPort = "";
    if (hostHeader.startsWith("[")) {
      const closeBracket = hostHeader.indexOf("]");
      expectedHost = hostHeader.slice(1, closeBracket);
      expectedPort = hostHeader.slice(closeBracket + 1).replace(/^:/, "");
    } else if (hostHeader.includes(":")) {
      const parts = hostHeader.split(":");
      expectedHost = parts[0];
      expectedPort = parts[1];
    }
    const isEncrypted = Boolean(req.socket?.encrypted || req.connection?.encrypted || headers["x-forwarded-proto"] === "https");
    if (!expectedPort) {
      expectedPort = isEncrypted ? "443" : "80";
    }
    const actualHost = originUrl.hostname.toLowerCase().replace(/^[\[]|[\]]$/g, "");
    const actualPort = originUrl.port || (originUrl.protocol === "https:" ? "443" : "80");
    if (actualPort !== expectedPort) {
      return false;
    }
    if (actualHost === expectedHost) {
      return true;
    }
    const loopbackAliases = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
    if (loopbackAliases.has(actualHost) && loopbackAliases.has(expectedHost)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
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
          if (!isSafeRequest(req)) {
            writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "\u8DE8\u7AD9\u6216\u975E\u6CD5\u8BF7\u6C42\u6E90\u88AB\u62E6\u622A (Cross-site request blocked)" } });
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
              try {
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
              } catch (traversalErr) {
                writeJson(res, 403, { ok: false, error: { code: "forbidden", message: traversalErr?.message || "\u8BBF\u95EE\u88AB\u62D2\u7EDD\uFF1A\u8D85\u51FA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u8303\u56F4" } });
                return;
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
  const requestedPath = args.path !== void 0 ? args.path : args.cwd;
  if (remoteInfo && args.host && args.host.toLowerCase() !== remoteInfo.meta.host.toLowerCase()) {
    return {
      host: null,
      remoteRoot: remoteInfo.meta.remotePath,
      resolvedPath: null,
      error: `\u5DE5\u4F5C\u533A\u9694\u79BB\u62D2\u7EDD\uFF1A\u5F53\u524D\u4F1A\u8BDD\u7ED1\u5B9A\u8FDC\u7A0B\u4E3B\u673A "${remoteInfo.meta.host}"\uFF0C\u7981\u6B62\u8DE8\u4E3B\u673A\u5411 "${args.host}" \u6267\u884C\u64CD\u4F5C`
    };
  }
  const host = args.host || remoteInfo?.meta.host;
  const remoteRoot = remoteInfo?.meta.remotePath || "/";
  if (host && !isValidSshHost(host)) {
    return { host: null, remoteRoot, resolvedPath: null, error: `\u4E3B\u673A\u6821\u9A8C\u5931\u8D25\uFF1A\u4E3B\u673A "${host}" \u975E\u6CD5\u6216\u4E0D\u5728 ~/.ssh/config \u5217\u8868\u4E2D` };
  }
  let resolvedPath = requestedPath;
  if (resolvedPath !== void 0 && resolvedPath !== "") {
    if (!resolvedPath.startsWith("/") && !resolvedPath.startsWith("~")) {
      resolvedPath = `${remoteRoot.replace(/\/+$/, "")}/${resolvedPath}`;
    }
  } else {
    resolvedPath = remoteRoot;
  }
  if (resolvedPath) {
    const normCheck = posix2.normalize(resolvedPath.replace(/\\/g, "/"));
    if (normCheck.startsWith("../") || normCheck === "..") {
      return { host, remoteRoot, resolvedPath: null, error: `\u8DEF\u5F84\u904D\u5386\u62E6\u622A\uFF1A\u7981\u6B62\u4F7F\u7528 ".." \u8BBF\u95EE\u8D8A\u6743\u8DEF\u5F84: "${requestedPath}"` };
    }
    if (remoteInfo) {
      if (resolvedPath.startsWith("~") && !remoteRoot.startsWith("~")) {
        return { host, remoteRoot, resolvedPath: null, error: `\u8DEF\u5F84\u62E6\u622A\uFF1A\u5F53\u524D\u5DE5\u4F5C\u533A\u76EE\u5F55\u9650\u5236\u5728 "${remoteRoot}"\uFF0C\u7981\u6B62\u8DE8\u8D8A\u5230\u7528\u6237\u5BB6\u76EE\u5F55: "${requestedPath}"` };
      }
      const cleanBase = posix2.normalize(remoteRoot.replace(/\\/g, "/"));
      const normTarget = posix2.normalize(resolvedPath.replace(/\\/g, "/"));
      const baseWithSlash = cleanBase.endsWith("/") ? cleanBase : cleanBase + "/";
      if (cleanBase !== "/" && !normTarget.startsWith(baseWithSlash) && normTarget !== cleanBase) {
        return { host, remoteRoot, resolvedPath: null, error: `\u8DEF\u5F84\u904D\u5386\u62E6\u622A\uFF1A\u7981\u6B62\u8BBF\u95EE\u8D85\u51FA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u76EE\u5F55\u7684\u8DEF\u5F84: "${requestedPath}"` };
      }
      resolvedPath = normTarget;
    }
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
      const { host, remoteRoot, resolvedPath, error: ctxErr } = resolveContext(ctx, args, exec);
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
      const execDir = args.cwd ? resolvedPath : remoteRoot;
      let cmd = String(args.command || "").trim();
      if (execDir) {
        cmd = `${shellCd(execDir)} && ${cmd}`;
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
var failedAttempts = /* @__PURE__ */ new Map();
function rateLimitKey(host) {
  return host.trim().toLowerCase();
}
function rateLimitMessage(remainingSeconds) {
  return `\u8BA4\u8BC1\u5931\u8D25\u6B21\u6570\u8FC7\u591A\uFF0C\u4E3A\u9632\u6B62\u76EE\u6807\u4E3B\u673A\u8D26\u6237\u88AB\u9501\u5B9A\uFF0C\u8BF7\u5728 ${remainingSeconds} \u79D2\u540E\u91CD\u8BD5`;
}
function checkRateLimit(host) {
  const key = rateLimitKey(host);
  const now = Date.now();
  let record = failedAttempts.get(key);
  if (record && record.lockedUntil > 0 && record.lockedUntil <= now && record.count >= 5 && record.inFlight === 0) {
    failedAttempts.delete(key);
    record = void 0;
  }
  if (record && record.lockedUntil > now) {
    return rateLimitMessage(Math.ceil((record.lockedUntil - now) / 1e3));
  }
  if (record && record.count + record.inFlight >= 5) {
    record.lockedUntil = now + 3e4;
    failedAttempts.set(key, record);
    return rateLimitMessage(30);
  }
  const next = record || { count: 0, lockedUntil: 0, inFlight: 0 };
  next.inFlight += 1;
  failedAttempts.set(key, next);
  return null;
}
function recordAttemptResult(host, success) {
  const key = rateLimitKey(host);
  const current = failedAttempts.get(key) || { count: 0, lockedUntil: 0, inFlight: 0 };
  current.inFlight = Math.max(0, current.inFlight - 1);
  if (success) {
    current.count = 0;
    current.lockedUntil = 0;
  } else {
    current.count += 1;
    if (current.count >= 5) {
      current.lockedUntil = Date.now() + 3e4;
    }
  }
  if (current.count === 0 && current.inFlight === 0) {
    failedAttempts.delete(key);
  } else {
    failedAttempts.set(key, current);
  }
}
async function verifyAndCachePassword(host, password) {
  const rateErr = checkRateLimit(host);
  if (rateErr) {
    return { ok: false, message: rateErr, rateLimited: true };
  }
  try {
    const result = await testSshConnection(host, password);
    recordAttemptResult(host, result.ok);
    if (result.ok) {
      setHostPassword(host, password);
    }
    return result;
  } catch (err) {
    recordAttemptResult(host, false);
    return { ok: false, message: err?.message || String(err) || "\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25" };
  }
}
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
          if (!isSafeRequest(req)) {
            sendJson(res, 403, { ok: false, error: "\u8DE8\u7AD9\u6216\u975E\u6CD5\u8BF7\u6C42\u6E90\u88AB\u62E6\u622A (Cross-site request blocked)" });
            return;
          }
          if (method === "hosts") {
            const rawHosts = parseSshConfig();
            const sanitizedHosts = rawHosts.map((h) => ({
              host: h.host,
              hostName: h.hostName,
              user: h.user,
              port: h.port,
              hasIdentityFile: Boolean(h.identityFile),
              proxyJump: h.proxyJump,
              passwordAuthentication: h.passwordAuthentication
            }));
            sendJson(res, 200, { ok: true, hosts: sanitizedHosts });
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          const body = await readJson(req);
          const host = typeof body.host === "string" ? body.host.trim() : body.host;
          if (host && !isValidSshHost(host)) {
            sendJson(res, 400, { ok: false, error: `\u975E\u6CD5\u6216\u4E0D\u5728 ~/.ssh/config \u5217\u8868\u4E2D\u7684\u4E3B\u673A\u540D: "${body.host}"` });
            return;
          }
          if (method === "auth-submit") {
            if (!host || typeof body.password !== "string" || !body.password) {
              sendJson(res, 400, { ok: false, error: "host and password are required" });
              return;
            }
            const r = await verifyAndCachePassword(host, body.password);
            if (r.rateLimited) {
              sendJson(res, 429, { ok: false, error: r.message });
            } else if (r.ok) {
              sendJson(res, 200, { ok: true, message: "\u8BA4\u8BC1\u6210\u529F" });
            } else {
              sendJson(res, 400, { ok: false, error: r.message || "\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25" });
            }
            return;
          }
          if (method === "test") {
            if (!host) {
              sendJson(res, 400, { ok: false, error: "host is required" });
              return;
            }
            if (body.password !== void 0) {
              if (typeof body.password !== "string" || !body.password) {
                sendJson(res, 400, { ok: false, error: "password must be a non-empty string" });
                return;
              }
              const r = await verifyAndCachePassword(host, body.password);
              if (r.rateLimited) {
                sendJson(res, 429, { ok: false, error: r.message });
              } else {
                sendJson(res, 200, { ok: r.ok, message: r.message });
              }
            } else {
              const r = await testSshConnection(host);
              sendJson(res, 200, r);
            }
            return;
          }
          if (method === "browse") {
            if (!host) {
              sendJson(res, 400, { ok: false, error: "host is required" });
              return;
            }
            if (body.password !== void 0) {
              if (typeof body.password !== "string" || !body.password) {
                sendJson(res, 400, { ok: false, error: "password must be a non-empty string" });
                return;
              }
              const auth = await verifyAndCachePassword(host, body.password);
              if (auth.rateLimited) {
                sendJson(res, 429, { ok: false, error: auth.message });
                return;
              }
              if (!auth.ok) {
                sendJson(res, 400, { ok: false, error: auth.message || "\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25" });
                return;
              }
            }
            const r = await remoteBrowseDirs(host, body.path || "~");
            sendJson(res, r.ok ? 200 : 400, r);
            return;
          }
          if (method === "create-workspace") {
            if (!host || !body.remotePath) {
              sendJson(res, 400, { ok: false, error: "host and remotePath are required" });
              return;
            }
            if (body.authType === "password") {
              if (typeof body.password !== "string" || !body.password) {
                sendJson(res, 400, { ok: false, error: "password must be a non-empty string" });
                return;
              }
              const auth = await verifyAndCachePassword(host, body.password);
              if (auth.rateLimited) {
                sendJson(res, 429, { ok: false, error: auth.message });
                return;
              }
              if (!auth.ok) {
                sendJson(res, 400, { ok: false, error: auth.message || "\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25" });
                return;
              }
            }
            const r = await createRemoteWorkspace(
              ctx.workspaceRegistry,
              host,
              body.remotePath,
              body.title,
              body.authType
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
  closeSshConnection,
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
  isSafeRequest,
  isValidSshHost,
  localToRemotePath,
  name,
  parseSshConfig,
  registerFsInterceptors,
  registerTools,
  remoteBrowseDirs,
  remoteListDir,
  remoteReadFile,
  remoteSearchFiles,
  remoteWriteFile,
  removeHostPassword,
  runSsh,
  setHostPassword,
  shellCd,
  shellQuote,
  testSshConnection
};
