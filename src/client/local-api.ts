export type LocalAccountStatus = {
  source: "none" | "environment" | "database";
  revision: number;
  verifiedAt: number | null;
  database: "sqlite";
  schemaVersion: number;
  partyCount: number;
  scope: "local-owner" | "guest";
};
export async function localApi<T>(input: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/local", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(90000),
    });
  } catch { throw new Error("未能连接服务，请确认发起人的程序仍在运行后重试。"); }
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && "code" in data && data.code === "SHARE_LOGIN_REQUIRED") globalThis.dispatchEvent(new Event("maimai-access-expired"));
  if (!response.ok || !data) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "本机数据库服务暂不可用，请重试。");
  return data as T;
}
