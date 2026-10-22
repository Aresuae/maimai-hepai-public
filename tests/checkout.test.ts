import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CheckoutStore, type CheckoutDependencies } from "../src/server/checkout.ts";
import { safePaymentUrl, parseCreatedOrder, parseOrderStatus } from "../src/providers/mcd-orders.ts";
import { SharedTables } from "../src/server/shared-tables.ts";
import { sharedCheckoutRef, type SharedTable } from "../src/domain/shared-table.ts";
const token = "TEST_ACCOUNT_ONLY";
const prepareInput = { action: "prepare", storeCode: "12345", expectedCents: 2490, selections: [{ productCode: "burger", configurationKey: "a".repeat(64) }] };
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "maimai-checkout-test-"));
  const path = join(directory, "orders.sqlite"); const store = new CheckoutStore(path);
  const extraClosers: (() => void)[] = [];
  t.after(() => { extraClosers.forEach(close => close()); store.close(); if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("maimai-checkout-test-")) throw new Error("Unsafe cleanup"); rmSync(directory, { recursive: true }); });
  let writes = 0; let request: Record<string, unknown> | null = null;
  const deps: CheckoutDependencies = {
    check() {},
    async prepare(code) { return { request: { storeCode: code, orderType: 1, beType: 1, needTableware: false, items: [{ productCode: "burger", quantity: 1 }] },
      view: { source: "live", quotedAt: Date.now(), storeCode: code, dining: "pickup", selections: [{ productCode: "burger", name: "巨无霸", couponSelected: false }], quote: { price: 2490, productList: [{ productCode: "burger", productName: "巨无霸", quantity: 1, subtotal: 2490 }], takeWayList: [{ code: "PICKUP", title: "到店取餐" }] } } };
    },
    async create(args) { writes++; request = args; return { data: { orderId: "test-order", payH5Url: "https://pay.mcd.cn/test" } }; },
    async query(id) { return { data: { orderId: id, orderStatus: "2", pickupCode: "TEST123", deliveryInfo: { mobilePhone: "PRIVATE" } } }; },
  };
  return { path, store, deps, extraClosers, writes: () => writes, request: () => request };
}

test("partial shared checkout names and claims just the selected member, then permits the remaining batch", async t => {
  const f = fixture(t); const tables = new SharedTables(join(dirname(f.path), "tables.sqlite")); f.extraClosers.push(() => tables.close());
  let table = tables.action({ action: "create", title: "分批结算", capacity: 3, name: "发起人", budgetCents: 6000, catalog: { storeCode: "12345", storeName: "测试店", items: [{ code: "burger", name: "巨无霸", category: "mains" }] } }, "host");
  const hostId = table.myMemberId;
  table = tables.action({ action: "join", id: table.id, invite: table.invite, name: "先选好的朋友", budgetCents: 4500 }, "friend");
  const friendId = table.myMemberId;
  table = tables.action({ action: "update", id: table.id, revision: 0, name: "先选好的朋友", budgetCents: 4500, picks: [{ code: "burger", quantity: 1 }], ready: true }, "friend");
  const ref = (snapshot: SharedTable, memberId: string) => sharedCheckoutRef({ ...snapshot, managementRevision: snapshot.managementRevision ?? 0, members: snapshot.members.filter(m => m.id === memberId) });
  f.deps.check = (shared, order) => { if (shared) return tables.checkCheckout(shared, "host", order); };
  f.deps.claim = shared => tables.claimCheckout(shared, "host");
  const input = { ...prepareInput, shared: ref(table, friendId) };
  await assert.rejects(f.store.action({ ...input, selections: [{ productCode: "forged", configurationKey: "a".repeat(64) }] }, token, f.deps), /餐单与/);
  const first = (await f.store.action(input, token, f.deps))!;
  const competing = (await f.store.action(input, "SECOND_ACCOUNT", f.deps))!;
  assert.deepEqual(first.memberNames, ["先选好的朋友"]);
  table = tables.action({ action: "update", id: table.id, revision: 0, name: "发起人", budgetCents: 6500, picks: [{ code: "burger", quantity: 1 }], ready: true }, "host");
  await f.store.action({ action: "confirm", id: first.id, takeWayCode: "PICKUP", confirmed: true }, token, f.deps);
  assert.equal(f.writes(), 1);
  assert.equal(tables.action({ action: "read", id: table.id }, "host").members.find(m => m.id === friendId)!.submitted, true);
  await assert.rejects(f.store.action({ action: "confirm", id: competing.id, takeWayCode: "PICKUP", confirmed: true }, "SECOND_ACCOUNT", f.deps), /已变化/);
  await f.store.action({ action: "refresh", id: first.id }, token, f.deps);
  await assert.rejects(f.store.action(input, token, f.deps), /已变化/);
  table = tables.action({ action: "read", id: table.id }, "host");
  const second = (await f.store.action({ ...prepareInput, shared: ref(table, hostId) }, token, f.deps))!;
  assert.deepEqual(second.memberNames, ["发起人"]);
  assert.equal(f.writes(), 1); // A new confirmation never auto-pays or auto-submits.
});

test("failed shared submission stays claimed and cannot become another person's duplicate order", async t => {
  const f = fixture(t); const tables = new SharedTables(join(dirname(f.path), "tables.sqlite")); f.extraClosers.push(() => tables.close());
  let table = tables.action({ action: "create", title: "未知结果", capacity: 2, name: "发起人", budgetCents: 6000, catalog: { storeCode: "12345", storeName: "测试店", items: [{ code: "burger", name: "巨无霸", category: "mains" }] } }, "host");
  table = tables.action({ action: "update", id: table.id, revision: 0, name: "发起人", budgetCents: 6000, picks: [{ code: "burger", quantity: 1 }], ready: true }, "host");
  const shared = sharedCheckoutRef({ ...table, managementRevision: table.managementRevision ?? 0 });
  f.deps.check = (ref, order) => { if (ref) return tables.checkCheckout(ref, "host", order); };
  f.deps.claim = ref => tables.claimCheckout(ref, "host");
  f.deps.create = async () => { throw new Error("timeout"); };
  const row = (await f.store.action({ ...prepareInput, shared }, token, f.deps))!;
  const result = (await f.store.action({ action: "confirm", id: row.id, takeWayCode: "PICKUP", confirmed: true }, token, f.deps))!;
  assert.equal(result.state, "unknown");
  await assert.rejects(f.store.action({ ...prepareInput, shared }, "OTHER_ACCOUNT", f.deps), /已变化/);
});
test("quotation/prepare has no order side effects; explicit confirmation creates exactly once across concurrent requests and restarts", async t => {
  const f = fixture(t); const prepared = (await f.store.action(prepareInput, token, f.deps))!;
  assert.equal(prepared.state, "prepared"); assert.equal(f.writes(), 0);
  assert.equal(JSON.stringify(prepared).includes(token), false); assert.equal("selections" in prepared, false);
  await assert.rejects(f.store.action({ action: "confirm", id: prepared.id, takeWayCode: "PICKUP", confirmed: false }, token, f.deps));
  const command = { action: "confirm", id: prepared.id, takeWayCode: "PICKUP", confirmed: true };
  await Promise.all([f.store.action(command, token, f.deps), f.store.action(command, token, f.deps)]);
  assert.equal(f.writes(), 1); assert.equal(f.request()!.takeWayCode, "PICKUP"); assert.equal(f.request()!.withOrder, undefined);
  const reopened = new CheckoutStore(f.path);
  try { assert.equal((await reopened.action(command, token, f.deps))!.orderId, "test-order"); assert.equal(f.writes(), 1); }
  finally { reopened.close(); }
  assert.equal((await f.store.action({ action: "latest" }, token, f.deps))!.state, "created");
  const paid = (await f.store.action({ action: "refresh", id: prepared.id }, token, f.deps))!;
  assert.equal(paid.state, "finished"); assert.equal(paid.payUrl, undefined); assert.equal(paid.pickupCode, "TEST123");
  assert.equal(JSON.stringify(paid).includes("PRIVATE"), false);
  assert.equal(await f.store.action({ action: "latest" }, token, f.deps), null);
});
test("price, take-way, account and shared table changes prevent creation", async t => {
  const f = fixture(t); const prepared = (await f.store.action(prepareInput, token, f.deps))!;
  const command = { action: "confirm", id: prepared.id, takeWayCode: "PICKUP", confirmed: true };
  await assert.rejects(f.store.action(command, "OTHER_ACCOUNT", f.deps), /其他账号/);
  await assert.rejects(f.store.action({ ...command, takeWayCode: "FORGED" }, token, f.deps), /取餐方式/);
  const original = f.deps.prepare;
  f.deps.prepare = async (...args) => { const next = await original(...args); next.view.quote.price++; return next; };
  await assert.rejects(f.store.action(command, token, f.deps), /价格已变化/);
  f.deps.prepare = original; f.deps.check = () => { throw new Error("共享餐桌已变化"); };
  await assert.rejects(f.store.action(command, token, f.deps), /共享餐桌已变化/);
  assert.equal(f.writes(), 0);
});
test("ambiguous upstream failures are persisted and block retries/new attempts", async t => {
  const f = fixture(t); let calls = 0;
  f.deps.create = async () => { calls++; throw new Error("network timeout containing PRIVATE_TOKEN"); };
  const row = (await f.store.action(prepareInput, token, f.deps))!;
  const command = { action: "confirm", id: row.id, takeWayCode: "PICKUP", confirmed: true };
  assert.equal((await f.store.action(command, token, f.deps))!.state, "unknown");
  assert.equal((await f.store.action(command, token, f.deps))!.state, "unknown");
  const recovered = (await f.store.action(prepareInput, token, f.deps))!;
  assert.equal(recovered.id, row.id); assert.equal(calls, 1);
  assert.equal(JSON.stringify(recovered).includes("PRIVATE_TOKEN"), false);
});
test("two prepared pages cannot each submit a new order for one account", async t => {
  const f = fixture(t);
  const a = (await f.store.action(prepareInput, token, f.deps))!;
  const b = (await f.store.action(prepareInput, token, f.deps))!;
  await Promise.all([a, b].map(row => f.store.action({ action: "confirm", id: row.id, takeWayCode: "PICKUP", confirmed: true }, token, f.deps)));
  assert.equal(f.writes(), 1);
});
test("payment links are HTTPS official hosts only, missing links preserve the order for App recovery", () => {
  for (const url of ["javascript:alert(1)", "https://mcd.cn.evil.example/a", "https://mcd.cn@evil.example/a", "http://mcd.cn/a", "https://pay.mcd.cn:8443/a", "https://evil.example/a"]) assert.equal(safePaymentUrl(url), undefined);
  assert.equal(safePaymentUrl("https://pay.mcd.cn/a"), "https://pay.mcd.cn/a");
  assert.equal(parseCreatedOrder({ data: { orderId: "123", payH5Url: "https://unknown.example/" } }).orderId, "123");
  assert.throws(() => parseOrderStatus({ data: { orderId: "OTHER", orderStatus: "1" } }, "123"), /不匹配/);
});
test("expired confirmations, missing take-ways and late account changes never create orders", async t => {
  const f = fixture(t);
  const prepared = (await f.store.action(prepareInput, token, f.deps))!;
  const db = new DatabaseSync(f.path);
  try {
    const row = JSON.parse(db.prepare("SELECT payload FROM checkouts WHERE id=?").get(prepared.id)!.payload as string);
    row.expiresAt = 0; db.prepare("UPDATE checkouts SET payload=? WHERE id=?").run(JSON.stringify(row), prepared.id);
  } finally { db.close(); }
  await assert.rejects(f.store.action({ action: "confirm", id: prepared.id, takeWayCode: "PICKUP", confirmed: true }, token, f.deps), /过期/);
  const original = f.deps.prepare;
  f.deps.prepare = async (...args) => { const next = await original(...args); next.view.quote.takeWayList = []; return next; };
  await assert.rejects(f.store.action(prepareInput, token, f.deps), /取餐方式/);
  f.deps.prepare = original;
  const next = (await f.store.action(prepareInput, token, f.deps))!;
  let checks = 0; f.deps.check = () => { if (++checks === 3) throw new Error("账号已经断开"); };
  await assert.rejects(f.store.action({ action: "confirm", id: next.id, takeWayCode: "PICKUP", confirmed: true }, token, f.deps), /账号已经断开/);
  assert.equal(f.writes(), 0);
});
test("drive-through options are excluded from pickup-only checkout and cannot be forged at confirmation", async t => {
  const f = fixture(t); const original = f.deps.prepare;
  f.deps.prepare = async (...args) => { const next = await original(...args); next.view.quote.takeWayList!.push({ code: "DT", title: "得来速", subtitle: "车道自提" }); return next; };
  const row = (await f.store.action(prepareInput, token, f.deps))!;
  assert.equal(row.takeWays.length, 1);
  await assert.rejects(f.store.action({ action: "confirm", id: row.id, takeWayCode: "DT", confirmed: true }, token, f.deps), /取餐方式/);
  assert.equal(f.writes(), 0);
});
