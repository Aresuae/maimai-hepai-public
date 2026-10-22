import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { ShareAccess, SESSION_SECONDS } from "../src/server/share-access.ts";
import { createShareServer } from "../src/server/share-server.ts";
import { LocalDatabase } from "../src/server/local-database.ts";
import { SharedTables } from "../src/server/shared-tables.ts";
import { makePublishedBuddy } from "../src/domain/buddy-publishing.ts";
import { tunnelUrlFromLine } from "../scripts/share-tunnel-url.mjs";

const invitation = "test-invitation-code-2026";
const origin = "https://maimai-testing.trycloudflare.com";
function cleanup(directory: string) {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("maimai-share-test-")) throw new Error("Unsafe test cleanup");
  rmSync(directory, { recursive: true });
}
function temporary(t: TestContext, autoCleanup = true) {
  const directory = mkdtempSync(join(tmpdir(), "maimai-share-test-"));
  if (autoCleanup) t.after(() => cleanup(directory));
  return directory;
}
async function fixture(t: TestContext) {
  const directory = temporary(t, false);
  const staticDirectory = join(directory, "static");
  mkdirSync(join(staticDirectory, "assets"), { recursive: true });
  writeFileSync(join(staticDirectory, "share.html"), "<!doctype html><title>safe-client</title>");
  writeFileSync(join(staticDirectory, "assets", "app-test.js"), "window.test=true");
  writeFileSync(join(staticDirectory, "assets", "app-test.js.map"), "PRIVATE_SOURCE");
  const app = createShareServer({ directory: join(directory, "guests"), staticDirectory, invitation, localOrigin: "http://127.0.0.1:5174" });
  app.setPublicOrigin(origin);
  await new Promise<void>(ready => app.server.listen(0, "127.0.0.1", ready));
  const port = (app.server.address() as { port: number }).port;
  t.after(async () => {
    await new Promise<void>(done => { app.server.close(() => done()); app.server.closeAllConnections(); });
    cleanup(directory);
  });
  function call(path: string, body?: unknown, cookie = "", overrides: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }>((done, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST", headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", Cookie: cookie, ...overrides } }, res => {
        let text = ""; res.setEncoding("utf8"); res.on("data", chunk => { text += chunk; });
        res.on("end", () => done({ status: res.statusCode!, body: text, headers: res.headers }));
      });
      req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function login() {
    const result = await call("/api/access", { action: "login", code: invitation });
    assert.equal(result.status, 200);
    return result.headers["set-cookie"]![0].split(";")[0];
  }
  return { ...app, directory, call, login };
}

test("public gateway blocks anonymous APIs, cross-origin writes and unknown hosts", async t => {
  const f = await fixture(t);
  assert.equal((await f.call("/api/local", { action: "status" })).status, 401);
  assert.equal((await f.call("/api/mcd", { action: "stores" })).status, 401);
  assert.equal((await f.call("/api/table", { action: "read", id: "0".repeat(24) })).status, 401);
  assert.equal((await f.call("/api/checkout", { action: "latest" })).status, 401);
  assert.equal((await f.call("/api/access", { action: "login", code: invitation }, "", { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await f.call("/", undefined, "", { Host: "attacker.example" })).status, 403);
  const login = await f.call("/api/access", { action: "login", code: invitation });
  assert.match(login.headers["set-cookie"]![0], /^__Host-maimai_guest=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure$/);
  assert.equal(login.headers["access-control-allow-origin"], undefined);
  assert.equal((await f.call("/api/access", { action: "login", code: "wrong" })).status, 403);
  assert.equal(JSON.parse((await f.call("/api/access")).body).authenticated, false);
});

test("only compiled entry and asset allowlist are public; data, dev source and maps stay private", async t => {
  const f = await fixture(t);
  assert.equal((await f.call("/")).status, 200);
  assert.equal((await f.call("/design")).status, 200);
  assert.equal((await f.call("/assets/app-test.js")).status, 200);
  for (const path of ["/.env.local", "/data/maimai.sqlite", "/src/server/share-access.ts", "/@fs/E:/mmm/.env.local", "/assets/app-test.js.map", "/assets/../share.html", "/%2e%2e/.env.local", "/api/owner"])
    assert.equal((await f.call(path)).status, 404, path);
  const page = await f.call("/");
  assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(page.headers["cache-control"], "no-store");
  const compressed = await f.call("/assets/app-test.js", undefined, "", { "Accept-Encoding": "gzip" });
  assert.equal(compressed.headers["content-encoding"], "gzip");
  const plainHttp = await f.call("/", undefined, "", { "x-forwarded-proto": "http" });
  assert.equal(plainHttp.status, 308); assert.equal(plainHttp.headers.location, `${origin}/`);
});

test("two visitors have isolated SQLite data and credentials; owner token never falls back", async t => {
  const f = await fixture(t);
  const previousToken = process.env.MCD_MCP_TOKEN;
  process.env.MCD_MCP_TOKEN = "TEST_OWNER_MUST_NEVER_REACH_GUEST";
  t.after(() => { if (previousToken === undefined) delete process.env.MCD_MCP_TOKEN; else process.env.MCD_MCP_TOKEN = previousToken; });
  const a = await f.login();
  const aStatus = JSON.parse((await f.call("/api/local", { action: "status" }, a)).body);
  assert.equal(aStatus.source, "none"); assert.equal(aStatus.scope, "guest");
  const workspaceA = readdirSync(join(f.directory, "guests/workspaces"))[0];
  const now = Date.now();
  const nextDay = new Date(now + 86400000).toISOString().slice(0, 10);
  const party = makePublishedBuddy({ host: "访客甲", title: "甲的独立午餐", city: "上海市", area: "人民广场附近", mealDate: nextDay, window: "lunch", capacity: 4, minBudgetCents: 2500, maxBudgetCents: 5000, payment: "separate", tags: ["轻松聊天"] }, "local-guest-a", now);
  assert.equal((await f.call("/api/local", { action: "save-parties", revision: 0, parties: [party] }, a)).status, 200);
  const guestDb = new LocalDatabase(join(f.directory, "guests/workspaces", workspaceA, "maimai.sqlite"));
  guestDb.connect("TEST_GUEST_A_PRIVATE_AUTH", 0); guestDb.close();
  const b = await f.login();
  assert.notEqual(a, b);
  const bStatus = JSON.parse((await f.call("/api/local", { action: "status" }, b)).body);
  assert.equal(bStatus.source, "none"); assert.equal(bStatus.partyCount, 0);
  assert.deepEqual(JSON.parse((await f.call("/api/local", { action: "parties" }, b)).body).parties, []);
  assert.equal(JSON.parse((await f.call("/api/local", { action: "parties" }, a)).body).parties[0].host, "访客甲");
  assert.equal((await f.call("/api/mcd", { action: "stores", city: "上海", keyword: "人民广场" }, b, { "X-Maimai-Account-Version": "0" })).status, 401);
  assert.equal((await f.call("/api/access", { action: "logout" }, a)).status, 200);
  assert.equal((await f.call("/api/local", { action: "status" }, a)).status, 401);
  const after = new LocalDatabase(join(f.directory, "guests/workspaces", workspaceA, "maimai.sqlite"));
  assert.equal(after.credential().token, null); after.close();
  assert.equal((await f.call("/api/local", { action: "status" }, b)).status, 200);
});

test("table invitation joins authenticated visitors to one table while preserving member ownership", async t => {
  const f = await fixture(t); const host = await f.login(); const friend = await f.login();
  const created = await f.call("/api/table", { action: "create", title: "网关联调餐桌", capacity: 2, name: "发起人", budgetCents: 6000,
    catalog: { storeCode: "123", storeName: "测试餐厅", items: [{ code: "001", name: "巨无霸", category: "mains" }] } }, host);
  assert.equal(created.status, 200);
  const table = JSON.parse(created.body);
  assert.equal(table.publicOrigin, origin);
  assert.equal((await f.call("/api/table", { action: "read", id: table.id }, friend)).status, 403);
  const joined = JSON.parse((await f.call("/api/table", { action: "join", id: table.id, invite: table.invite, name: "朋友", budgetCents: 4500 }, friend)).body);
  assert.notEqual(joined.myMemberId, table.myMemberId); assert.equal(joined.isHost, false);
  assert.equal((await f.call("/api/table", { action: "update", id: table.id, revision: 0, name: "朋友", budgetCents: 5500, picks: [{ code: "001", quantity: 1 }], ready: true }, friend)).status, 200);
  const read = JSON.parse((await f.call("/api/table", { action: "read", id: table.id }, host)).body);
  assert.equal(read.members.find((m: { host: boolean }) => !m.host).budgetCents, 5500);
  assert.equal(read.members.find((m: { host: boolean }) => m.host).budgetCents, 6000);
  assert.equal((await f.call("/api/table", { action: "close", id: table.id, revision: read.revision, closed: true }, friend)).status, 403);
});

test("one table link admits a new isolated visitor without the global code, then joins under their own identity", async t => {
  const f = await fixture(t), host = await f.login();
  const table = JSON.parse((await f.call("/api/table", { action: "create", title: "直接链接", capacity: 2, name: "主人", budgetCents: 6000,
    catalog: { storeCode: "123", storeName: "餐厅", items: [{ code: "001", name: "巨无霸", category: "mains" }] } }, host)).body);
  const admission = { action: "table-login", id: table.id, invite: table.invite };
  const bad = await f.call("/api/access", { ...admission, invite: "x".repeat(32) });
  assert.equal(bad.status, 403); assert.equal(bad.headers["set-cookie"], undefined);
  assert.equal((await f.call("/api/access", admission, "", { Origin: "https://attacker.example" })).status, 403);
  const login = await f.call("/api/access", admission);
  assert.equal(login.status, 200);
  const friend = login.headers["set-cookie"]![0].split(";")[0];
  assert.notEqual(friend, host); assert.ok(!login.body.includes(table.invite));
  assert.equal((await f.call("/api/table", { action: "read", id: table.id }, friend)).status, 403);
  const before = JSON.parse((await f.call("/api/table", { action: "read", id: table.id }, host)).body);
  assert.equal(before.members.length, 1); // Opening the invitation does not reserve a seat.
  const joined = JSON.parse((await f.call("/api/table", { action: "join", id: table.id, invite: table.invite, name: "朋友", budgetCents: 4500 }, friend)).body);
  assert.equal(joined.isHost, false); assert.notEqual(joined.myMemberId, table.myMemberId);
  assert.equal(JSON.parse((await f.call("/api/local", { action: "status" }, friend)).body).source, "none");
  assert.equal((await f.call("/api/table", { action: "update", id: table.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [{ code: "001", quantity: 1 }], ready: true }, friend)).status, 200);
  const read = JSON.parse((await f.call("/api/table", { action: "read", id: table.id }, host)).body);
  assert.equal(read.members.find((m: { host: boolean }) => !m.host).picks[0].code, "001");
  const repeat = await f.call("/api/access", admission, friend);
  assert.equal(repeat.status, 200); assert.equal(repeat.headers["set-cookie"], undefined);
  assert.equal((await f.call("/api/access", admission)).status, 409); // Full table rejects new workspaces.
});

test("closed, expired and malformed table links never issue a guest session", async t => {
  const f = await fixture(t);
  const tables = new SharedTables(join(f.directory, "guests", "shared-tables.sqlite"));
  try {
    const input = { action: "create", title: "邀请边界", capacity: 2, name: "主人", budgetCents: 6000, catalog: { storeCode: "123", storeName: "餐厅", items: [{ code: "a", name: "餐品", category: "mains" }] } };
    const expired = tables.action(input, "owner", Date.now() - 86401000);
    const closed = tables.action(input, "owner");
    tables.action({ action: "close", id: closed.id, revision: closed.revision, closed: true }, "owner");
    for (const [table, status] of [[expired, 410], [closed, 409]] as const) {
      const result = await f.call("/api/access", { action: "table-login", id: table.id, invite: table.invite });
      assert.equal(result.status, status); assert.equal(result.headers["set-cookie"], undefined);
    }
    assert.equal((await f.call("/api/access", { action: "table-login", id: "bad", invite: "bad" })).status, 400);
  } finally { tables.close(); }
});

test("sessions are hashed, origin-bound, expire, survive restart; login rate limit persists", t => {
  const directory = temporary(t);
  let access = new ShareAccess(directory, invitation);
  const now = Date.now();
  const login = access.login(invitation, origin, now);
  assert.equal(access.lookup(login.token, origin, now)?.workspace, login.workspace);
  assert.equal(access.lookup(login.token, "http://127.0.0.1:5174", now), null);
  assert.equal(access.lookup(login.token, origin, now + SESSION_SECONDS * 1000), null);
  access.limit("login", 1, 60000, now);
  access.close();
  assert.equal(readFileSync(join(directory, "sessions.sqlite")).includes(Buffer.from(login.token)), false);
  access = new ShareAccess(directory, invitation);
  try {
    assert.equal(access.lookup(login.token, origin, now)?.workspace, login.workspace);
    assert.throws(() => access.limit("login", 1, 60000, now), /频繁/);
    access.limit("login", 1, 60000, now + 60000);
    access.logout(login.token); assert.equal(access.lookup(login.token, origin, now), null);
  } finally { access.close(); }
});

test("tunnel launcher accepts registered HTTPS URL, never an admin link from a banner", () => {
  assert.equal(tunnelUrlFromLine("https://admin.localhost.run/", false), null);
  assert.equal(tunnelUrlFromLine(JSON.stringify({ type: "v1.tcpip_forward.register.accepted", source: "ssh://localhost.run/", data: "test.lhr.life tunneled, https://test.lhr.life\r\n" }), false), "https://test.lhr.life");
  assert.equal(tunnelUrlFromLine("https://test.trycloudflare.com", true), "https://test.trycloudflare.com");
});
