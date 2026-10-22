import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readMcpConfig, toolSchemaReport } from "../scripts/mcp-config.mjs";

test("configuration CLI runs without business calls and never prints the supplied credential", () => {
  const script = fileURLToPath(new URL("../scripts/mcp-inspect.mjs", import.meta.url));
  const dummy = "local-config-test-not-a-real-token";
  const result = spawnSync(process.execPath, [script, "--check-config"], {
    env: { ...process.env, MCD_MCP_TOKEN: dummy, MCD_MCP_URL: "https://mcp.mcd.cn" },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /未发出网络请求/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(dummy));
  const missing = spawnSync(process.execPath, [script, "--check-config"], {
    env: { ...process.env, MCD_MCP_TOKEN: "" }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /配置未就绪/);
});

test("MCP config rejects missing credentials and destinations other than official endpoint", () => {
  assert.throws(() => readMcpConfig({}), /MCD_MCP_TOKEN/);
  assert.throws(() => readMcpConfig({ MCD_MCP_TOKEN: "YOUR_MCP_TOKEN" }));
  for (const url of [
    "http://mcp.mcd.cn",
    "https://other.example",
    "https://mcp.mcd.cn@other.example",
    "https://mcp.mcd.cn:444",
    "https://mcp.mcd.cn?token=secret",
    "https://mcp.mcd.cn/unknown",
  ]) {
    assert.throws(() =>
      readMcpConfig({
        MCD_MCP_TOKEN: "test-only-placeholder",
        MCD_MCP_URL: url,
      }),
    );
  }
  assert.equal(
    readMcpConfig({ MCD_MCP_TOKEN: "test-only-placeholder" }).url.origin,
    "https://mcp.mcd.cn",
  );
});

test("tool schema report removes unrelated fields and redacts echoed credentials", () => {
  const raw = toolSchemaReport(
    [
      {
        name: "query-my-coupons",
        description: "secret-value",
        inputSchema: { type: "object" },
        outputSchema: undefined,
        account: "must-not-store",
      },
    ],
    "secret-value",
  );
  assert.ok(!raw.includes("secret-value"));
  assert.ok(!raw.includes("must-not-store"));
  assert.match(raw, /REDACTED/);
  assert.equal(JSON.parse(raw).tools[0].name, "query-my-coupons");
});
