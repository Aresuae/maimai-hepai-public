import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { readMcpConfig } from "../../scripts/mcp-config.mjs";
import { businessData, decodeToolResult } from "./mcd-response.ts";

export function safePaymentUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    // Only official hosts. Unknown payment hosts use the official App fallback.
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["mcd.cn", "mcdonalds.com.cn"].some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function parseCreatedOrder(raw: unknown) {
  const data = z.object({ orderId: z.string().min(1).max(128), payH5Url: z.unknown().optional() }).parse(businessData(raw));
  return { orderId: data.orderId, payUrl: safePaymentUrl(data.payH5Url) };
}
export function parseOrderStatus(raw: unknown, expectedId: string) {
  const data = z.object({ orderId: z.string(), orderStatus: z.string(), expirePayTime: z.string().optional(), pickupCode: z.string().optional() }).parse(businessData(raw));
  if (data.orderId !== expectedId) throw new Error("订单不匹配");
  return data;
}
/** Separate write boundary, only reached after explicit checkout confirmation. No automatic retries. */
export async function orderTool(env: Record<string, string | undefined>, name: "create-order" | "query-order", args: Record<string, unknown>) {
  const { token, url } = readMcpConfig(env);
  const client = new Client({ name: "maimai-confirmed-checkout", version: "0.1.0" });
  client.onerror = () => {};
  try {
    const signal = AbortSignal.timeout(45000);
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => token }, requestInit: { redirect: "error" } }), { signal, timeout: 15000 });
    await client.listTools(undefined, { signal, timeout: 15000 });
    return decodeToolResult(await client.callTool({ name, arguments: args }, { signal, timeout: 20000 }));
  } finally { await client.close().catch(() => {}); }
}
