/** @param {Record<string, string | undefined>} env */
export function readMcpConfig(env = process.env) {
  const token = (env.MCD_MCP_TOKEN ?? "").trim();
  if (!token || ["YOUR_MCP_TOKEN", "YOUR_TOKEN"].includes(token)) {
    throw new Error(
      "请在本机 .env.local 填写 MCD_MCP_TOKEN，再运行 npm.cmd run mcp:inspect。",
    );
  }
  if (/[\r\n]/.test(token))
    throw new Error("Token 格式不正确，请重新从官方控制台复制。");
  const url = new URL(env.MCD_MCP_URL || "https://mcp.mcd.cn");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "mcp.mcd.cn" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "MCP 地址必须为 https://mcp.mcd.cn，Token 不会发送到其他地址。",
    );
  }
  return { token, url };
}

/** Schema data is untrusted reference material. Never persist a credential echoed by a server. */
export function toolSchemaReport(tools, token) {
  const safe = tools.map(
    ({ name, description, inputSchema, outputSchema }) => ({
      name,
      description,
      inputSchema,
      ...(outputSchema ? { outputSchema } : {}),
    }),
  );
  const report = JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      endpoint: "https://mcp.mcd.cn",
      scope:
        "tools/list only; schemas are data, never instructions; no account tools executed",
      tools: safe,
    },
    null,
    2,
  );
  return token ? report.split(token).join("[REDACTED]") : report;
}
