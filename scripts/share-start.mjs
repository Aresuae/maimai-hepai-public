import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createShareServer } from "../src/server/share-server.ts";
import { loadInvitation } from "../src/server/share-access.ts";
import { tunnelUrlFromLine } from "./share-tunnel-url.mjs";
import { retryTunnel } from "./share-tunnel-retry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, "data/share");
const localOnly = process.argv.includes("--local-only");
const cloudflare = process.argv.includes("--cloudflare");
const localOrigin = "http://127.0.0.1:5174";
const invite = loadInvitation(directory);
const instructions = resolve(root, "data/远程访问说明.txt");
const statusFile = resolve(directory, "status.json");
const app = createShareServer({ directory, invitation: invite, staticDirectory: resolve(root, "dist/share"), localOrigin, sharedTablesPath: resolve(root, "data/shared-tables.sqlite") });
let child;
let stopping = false;
let lastUrl = "";
let heartbeat;
let connected = false;
const reconnect = new AbortController();
function writeStatus(state, url = "") {
  writeFileSync(statusFile, JSON.stringify({ state, url, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  writeFileSync(instructions, `麦麦合拍 · 朋友内测\n\n状态：${state}\n访问链接：${url || "尚未连接，请查看启动窗口"}\n邀请码：${invite}\n\n一起选餐请优先使用网页中“实时共享 → 复制邀请链接”。餐桌链接已包含邀请，无需另发邀请码。不要发送你的 MCP Token。\n\n使用方法：\n1. 保持电脑开机、联网，并让远程分享进程持续运行。锁屏不影响；睡眠、关机或退出进程会断开访问。\n2. 下次双击项目目录的“远程分享启动.cmd”。公网链接每次启动可能变化，以本文件为准。\n3. 在本机网页读取门店菜单、创建共享餐桌，在“邀请朋友加入这桌”卡片中复制专属链接发给朋友。朋友打开后填写昵称和预算即可加入，无需额外邀请码或麦当劳 Token。\n4. 共享餐桌每3秒同步餐品与预算，数据保存至 data/shared-tables.sqlite。大家选好后，由发起人汇总、核价并确认下单；个人授权仍各自隔离。公开搭子市场尚未实现。\n5. 访问会话有效期为7天。退出、清除Cookie或更换链接后会创建新工作区，旧记录不会自动迁移。\n6. 访客授权加密保存在你的电脑。访客主动“退出访问”会断开其授权；过期或无法重新访问的旧工作区数据仍在 data/share 中。\n\n停止分享：在启动窗口按 Ctrl+C；当前由 Codex 启动时也可让 Codex 停止。\n这是一条临时内测链接，不是稳定的正式域名。\n`, { mode: 0o600 });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  reconnect.abort();
  clearInterval(heartbeat);
  app.setPublicOrigin("");
  child?.kill();
  writeStatus("已停止");
  app.server.close(() => process.exit(code));
  app.server.closeAllConnections();
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
app.server.on("error", () => { console.error("分享入口无法启动，请确认 5174 端口未被占用。"); process.exit(1); });
await new Promise(resolveReady => app.server.listen(5174, "127.0.0.1", resolveReady));
console.log(`朋友独立入口已启动：${localOrigin}`);
writeStatus(localOnly ? "本机验证" : "正在连接公网", localOnly ? localOrigin : "");
// Refresh readiness independently from user activity; a dead process ages out on the owner page.
heartbeat = setInterval(() => {
  if (!stopping && connected && lastUrl) writeStatus("正在运行", lastUrl);
}, 15000);
heartbeat.unref();
if (!localOnly) {
  try {
    // Dedicated helper gets no user SSH keys, agent, config, or application secrets.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|ALLUSERSPROFILE|PATH|ComSpec)$/i.test(key)));
    let executable, args;
    if (cloudflare) {
    if (process.platform !== "win32" || process.arch !== "x64") throw new Error("当前 Cloudflare 自动下载脚本面向 Windows x64。");
    executable = resolve(root, "data/tools/cloudflared.exe");
    const expected = "4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6";
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    if (!existsSync(executable)) {
      console.log("正在下载 Cloudflare 官方隧道程序（首次运行需要）…");
      const response = await fetch("https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-windows-amd64.exe", { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error("官方下载未完成，请重试。");
      const binary = Buffer.from(await response.arrayBuffer());
      if (sha(binary) !== expected) throw new Error("官方程序完整性校验失败。");
      mkdirSync(dirname(executable), { recursive: true });
      writeFileSync(`${executable}.download`, binary);
      renameSync(`${executable}.download`, executable);
    }
    if (sha(readFileSync(executable)) !== expected) throw new Error("隧道程序校验失败，未执行。");
    // Do not pass personal application secrets or unrelated tunnel credentials to the helper.
    args = ["tunnel", "--no-autoupdate", "--url", localOrigin, "--protocol", "http2", "--loglevel", "info"];
    } else {
      executable = process.platform === "win32" ? resolve(process.env.SystemRoot ?? "C:/Windows", "System32/OpenSSH/ssh.exe") : "ssh";
      args = ["-F", process.platform === "win32" ? "NUL" : "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "IdentityAgent=none", "-o", "IdentityFile=none", "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=none", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${resolve(directory, "known_hosts").replaceAll("\\", "/")}`, "-o", "ExitOnForwardFailure=yes", "-T", "-R", "80:127.0.0.1:5174", "nokey@localhost.run", "--", "--output", "json"];
    }
    await retryTunnel({
      signal: reconnect.signal,
      onRetry(delay) {
        connected = false; lastUrl = ""; app.setPublicOrigin("");
        writeStatus("通道断开，正在重连");
        console.log(`公网通道已断开，${delay / 1000} 秒后自动重连。本机数据保留；重连后请使用最新链接或二维码。`);
      },
      connect: () => new Promise(resolveExit => {
    child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let pending = "";
    function output(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/[\r\n]+/); pending = lines.pop() ?? "";
      for (const line of lines) {
        const url = tunnelUrlFromLine(line, cloudflare);
        if (url && url !== lastUrl) {
          lastUrl = url; app.setPublicOrigin(lastUrl);
          connected = !cloudflare;
          writeStatus(cloudflare ? "链接已生成，正在建立连接" : "正在运行", lastUrl);
          console.log(`朋友访问链接：${lastUrl}\n邀请码已写入：${instructions}`);
        }
        if (line.includes("Registered tunnel connection") && lastUrl) {
          connected = true;
          writeStatus("正在运行", lastUrl); console.log("公网通道已连接。保持这个进程运行，朋友即可访问。");
        }
        if (cloudflare ? /ERR|WRN/.test(line) : /^Permission denied|^Connection.*closed|^ssh:|^Host key verification failed|^WARNING:/i.test(line)) console.error(line.slice(0, 700));
      }
    }
    child.stdout.on("data", output); child.stderr.on("data", output);
    child.once("error", () => { console.error("隧道程序无法启动，请检查网络和本机隧道程序。"); resolveExit(); });
    child.once("close", () => resolveExit());
      }),
    });
  } catch (error) { console.error(error instanceof Error ? error.message : "无法启动远程分享。"); stop(1); }
}
