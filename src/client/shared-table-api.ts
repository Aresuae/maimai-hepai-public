import type { SharedTable } from "../domain/shared-table";
export class SharedTableError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function sharedTableApi(input: Record<string, unknown>): Promise<SharedTable> {
  const res = await fetch("/api/table", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(20000) });
  const body = await res.json() as SharedTable & { error?: string; code?: string };
  if (body.code === "SHARE_LOGIN_REQUIRED") globalThis.dispatchEvent(new Event("maimai-access-expired"));
  if (!res.ok) throw new SharedTableError(body.error ?? "餐桌暂时无法同步，请重试。", res.status);
  return body;
}
