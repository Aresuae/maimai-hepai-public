import { z } from "zod";
import { LocalDatabase, LocalDataError } from "./local-database.ts";
import { McdReadOnlyClient } from "../providers/mcd-readonly.ts";
import { parsePublishedBuddies } from "../domain/buddy-publishing.ts";

const Revision = z.number().int().nonnegative();
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("connect"), revision: Revision, token: z.string().trim().min(10).max(8192).regex(/^[\x21-\x7E]+$/) }).strict(),
  z.object({ action: z.literal("verify"), revision: Revision }).strict(),
  z.object({ action: z.literal("disconnect"), revision: Revision }).strict(),
  z.object({ action: z.literal("parties") }).strict(),
  z.object({ action: z.literal("save-parties"), revision: Revision, parties: z.array(z.unknown()).max(20) }).strict(),
  z.object({ action: z.literal("import-parties"), parties: z.array(z.unknown()).max(20) }).strict(),
]);

export async function verifyMcdToken(token: string) {
  const client = await McdReadOnlyClient.connect({ MCD_MCP_TOKEN: token, MCD_MCP_URL: "https://mcp.mcd.cn" });
  try { await client.accountCoupons(1); } finally { await client.close(); }
}

export async function localWorkspaceAction(db: LocalDatabase, raw: unknown, environmentToken?: string, verify = verifyMcdToken) {
  const input = Input.parse(raw);
  if (input.action === "status") return db.status(!!environmentToken);
  if (input.action === "parties") return db.parties();
  if (input.action === "save-parties" || input.action === "import-parties") {
    const parties = parsePublishedBuddies(JSON.stringify({ version: 1, parties: input.parties }));
    return input.action === "save-parties" ? db.saveParties(input.revision, parties) : db.importParties(parties);
  }
  db.assertAccountRevision(input.revision);
  if (input.action === "disconnect") db.disconnect(input.revision);
  else {
    const token = input.action === "connect" ? input.token : db.credential(environmentToken).token;
    if (!token) throw new LocalDataError("尚未连接，请在官方平台登录并获取 MCP Token。");
    // A failed check never replaces a working credential. No account payload is returned or stored.
    try { await verify(token); }
    catch { throw new LocalDataError("官方授权验证未完成，请检查 Token 是否有效或稍后重试。原连接未被替换。", 502); }
    db.connect(token, input.revision);
  }
  return db.status(!!environmentToken);
}
