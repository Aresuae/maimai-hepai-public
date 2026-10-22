import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { LocalDatabase } from "../src/server/local-database.ts";
import { localWorkspaceAction } from "../src/server/local-workspace.ts";
import { makePublishedBuddy, setPublishedBuddyClosed } from "../src/domain/buddy-publishing.ts";

const now = Date.parse("2026-10-19T10:00:00+08:00");
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "maimai-db-test-"));
  const file = join(directory, "maimai.sqlite");
  let db = new LocalDatabase(file);
  t.after(() => {
    db.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("maimai-db-test-")) throw new Error("Unsafe test cleanup");
    rmSync(directory, { recursive: true });
  });
  return { file, directory, get db() { return db; }, reopen() { db.close(); db = new LocalDatabase(file); return db; } };
}
function party(id = "local-test") {
  return makePublishedBuddy({ host: "我", title: "测试午餐", city: "上海市", area: "人民广场商圈", mealDate: "2026-10-20", window: "lunch", capacity: 4, minBudgetCents: 2500, maxBudgetCents: 5000, payment: "separate", tags: ["轻松聊天"] }, id, now);
}
test("SQLite persists gatherings across process-equivalent reopen and preserves one host seat", t => {
  const f = fixture(t);
  const saved = f.db.saveParties(0, [party()], now);
  assert.equal(saved.revision, 1);
  assert.equal(saved.parties[0].occupied, 1);
  assert.deepEqual(f.reopen().parties(), saved);
  assert.equal(f.db.status(false).partyCount, 1);
});
test("SQLite CAS rejects stale writers without dropping another window's data", t => {
  const f = fixture(t);
  f.db.saveParties(0, [party()], now);
  const other = new LocalDatabase(f.file);
  try {
    assert.throws(() => other.saveParties(0, [party("local-other")], now), /其他页面/);
    assert.equal(other.parties().parties[0].id, "local-test");
    assert.throws(() => other.saveParties(1, [], now), /覆盖删除/);
  } finally { other.close(); }
});

test("expired published gatherings can be cancelled and reopened after editing the date", t => {
  const f = fixture(t);
  const saved = f.db.saveParties(0, [party()], now);
  const later = now + 86400000 * 3;
  const closed = setPublishedBuddyClosed(saved.parties[0], true, later);
  const cancelled = f.db.saveParties(saved.revision, [closed], later);
  assert.equal(f.reopen().parties().parties[0].closed, true);
  assert.throws(() => setPublishedBuddyClosed(closed, false, later), /过期/);
  const revised = makePublishedBuddy({ host: closed.host, title: closed.title, city: closed.city, area: closed.area,
    mealDate: "2026-10-24", window: closed.window, capacity: closed.capacity, minBudgetCents: closed.minBudgetCents,
    maxBudgetCents: closed.maxBudgetCents, payment: closed.payment, tags: closed.tags }, closed.id, later + 1, closed);
  const edited = f.db.saveParties(cancelled.revision, [revised], later + 1);
  assert.equal(edited.parties[0].closed, true);
  const reopened = f.db.saveParties(edited.revision, [setPublishedBuddyClosed(edited.parties[0], false, later + 2)], later + 2);
  assert.equal(reopened.parties[0].closed, false);
  assert.equal(reopened.parties[0].id, saved.parties[0].id);
  assert.equal(reopened.parties[0].createdAt, saved.parties[0].createdAt);
});
test("legacy import is idempotent and never overwrites newer database edits", t => {
  const f = fixture(t);
  const old = party();
  f.db.importParties([old]);
  const closed = setPublishedBuddyClosed(old, true, now + 1);
  f.db.saveParties(1, [closed], now + 1);
  assert.equal(f.db.importParties([old]).imported, 0);
  assert.equal(f.db.parties().parties[0].closed, true);
  assert.equal(f.db.parties().revision, 2);
});
test("credential is encrypted at rest, never appears in status, and survives restart", t => {
  const f = fixture(t);
  const token = "TEST_ONLY_PERSONAL_TOKEN_123456";
  f.db.connect(token, 0, now);
  for (const path of [f.file, f.file + "-wal"]) if (existsSync(path)) assert.equal(readFileSync(path).includes(Buffer.from(token)), false);
  assert.equal(JSON.stringify(f.db.status(true)).includes(token), false);
  assert.equal(f.reopen().credential().token, token);
  assert.equal(f.db.status(true).verifiedAt, now);
});
test("disconnect persists and prevents silent fallback to environment account", t => {
  const f = fixture(t);
  f.db.connect("test-token-0123456789", 0, now);
  f.db.disconnect(1);
  assert.equal(f.reopen().credential("ENV_TEST_TOKEN").token, null);
  assert.equal(f.db.status(true).source, "none");
  assert.throws(() => f.db.connect("late-token", 1), /账号连接已变化/);
});
test("missing vault key fails closed without generating a replacement", t => {
  const f = fixture(t);
  f.db.connect("test-token-0123456789", 0, now);
  renameSync(join(f.directory, "credential.key"), join(f.directory, "credential.backup"));
  assert.throws(() => f.db.credential("ENV_FALLBACK"), /无法解密/);
  assert.throws(() => f.db.connect("replacement-token", 1), /密钥缺失/);
  assert.equal(existsSync(join(f.directory, "credential.key")), false);
});
test("failed official verification and malformed input do not replace account", async t => {
  const f = fixture(t);
  f.db.connect("known-good-test-token", 0, now);
  await assert.rejects(localWorkspaceAction(f.db, { action: "connect", revision: 1, token: "invalid-test-token" }, undefined, async () => { throw new Error("test verification failed"); }));
  assert.equal(f.db.credential().token, "known-good-test-token");
  await assert.rejects(localWorkspaceAction(f.db, { action: "connect", revision: 1, token: "token\nheader-injection" }, undefined, async () => {}));
  await assert.rejects(localWorkspaceAction(f.db, { action: "status", token: "extra" }));
  assert.equal(f.db.status(false).revision, 1);
});
test("late verification cannot reconnect an account after disconnect", async t => {
  const f = fixture(t);
  await assert.rejects(localWorkspaceAction(f.db, { action: "connect", revision: 0, token: "new-test-token" }, undefined, async () => { f.db.disconnect(0); }), /账号连接已变化/);
  assert.equal(f.db.status(true).source, "none");
});
test("database enforces publish dates and capacity independently of browser", t => {
  const f = fixture(t);
  assert.throws(() => f.db.saveParties(0, [{ ...party(), capacity: 9 }], now));
  assert.throws(() => f.db.saveParties(0, [party()], now + 86400000 * 3), /已经开始/);
  assert.equal(f.db.parties().revision, 0);
});
