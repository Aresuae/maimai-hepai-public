import { mkdir, writeFile } from "node:fs/promises";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { readMcpConfig, toolSchemaReport } from "./mcp-config.mjs";

// Local, server-side preparation only. No tools/call, coupon claiming, redemption or order creation.
async function main() {
  const { token, url } = readMcpConfig();
  if (process.argv.includes("--check-config")) {
    console.log("本地配置格式有效（未验证 Token 是否可用，未发出网络请求）。");
    return;
  }
  const signal = AbortSignal.timeout(45_000);
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: { token: async () => token },
    requestInit: { redirect: "error" },
  });
  const client = new Client(
    { name: "maimai-hepai-capability-inspector", version: "0.1.0" },
    { listMaxPages: 20 },
  );
  client.onerror = () => {
    /* Errors are reported below without raw response bodies. */
  };
  try {
    await client.connect(transport, { signal, timeout: 12_000 });
    // SDK v2 aggregates tools/list pages, bounded by listMaxPages and this overall signal.
    const { tools } = await client.listTools(undefined, {
      signal,
      timeout: 12_000,
    });
    const directory = new URL("../artifacts/mcp/", import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(
      new URL("tools.json", directory),
      toolSchemaReport(tools, token),
      "utf8",
    );
    const expected = [
      "query-my-coupons",
      "query-store-coupons",
      "query-meals",
      "query-meal-detail",
      "calculate-price",
    ];
    const names = new Set(tools.map((tool) => tool.name));
    console.log(
      `已读取 ${tools.length} 项工具定义，保存到 artifacts/mcp/tools.json（已被 Git 忽略）。`,
    );
    for (const name of expected)
      console.log(`${names.has(name) ? "找到" : "未找到"}：${name}`);
    console.log(
      "此次只发现接口定义，没有查询账户卡券、领券、兑换、买卡或下单。页面仍为演示模式。",
    );
  } catch {
    console.error(
      "MCP 能力检查失败：请检查 Token 是否有效、网络及官方服务状态。没有输出原始响应或凭证，也没有执行业务工具。",
    );
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch(() => {
  console.error(
    "本地 MCP 配置未就绪。请在 .env.local 填写有效的 MCD_MCP_TOKEN，并保持 MCD_MCP_URL=https://mcp.mcd.cn。",
  );
  process.exitCode = 2;
});
