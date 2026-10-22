import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// A local preview supervisor, not an OS service or a production/public listener.
const root = fileURLToPath(new URL("../", import.meta.url));
const probe = createServer();
try {
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(5173, "127.0.0.1", resolve); });
  await new Promise(resolve => probe.close(resolve));
} catch {
  console.error("5173 端口已被占用。如果网页正在运行，不必重复启动；需要持续运行模式时，先关闭原启动终端。");
  process.exit(1);
}
let child;
let stopping = false;
let retries = [];
const stop = () => { stopping = true; child?.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("麦麦合拍个人工作区：http://127.0.0.1:5173/\n保持此窗口运行；Ctrl+C 停止。不会自动修改休眠或开机启动设置。");
while (!stopping) {
  const exited = await new Promise(resolve => {
    child = spawn(process.execPath, ["scripts/run-framework.mjs", "dev", "--host", "127.0.0.1", "--strictPort"], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", () => resolve(1));
    child.once("exit", code => resolve(code ?? 1));
  });
  if (stopping || exited === 0) break;
  retries = retries.filter(time => Date.now() - time < 120000);
  if (retries.length >= 5) { console.error("两分钟内连续启动失败，已停止重试。请先处理上方错误。"); process.exitCode = 1; break; }
  retries.push(Date.now());
  console.log("本机服务退出，5 秒后重启…");
  await new Promise(resolve => setTimeout(resolve, 5000));
}
