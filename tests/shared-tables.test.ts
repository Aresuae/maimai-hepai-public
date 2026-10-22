import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { SharedTables } from "../src/server/shared-tables.ts";
import { sharedCheckoutRef, sharedSelectionCurrent, type SharedTable } from "../src/domain/shared-table.ts";

const catalog = { storeCode: "12345", storeName: "测试餐厅", items: [
  { code: "burger", name: "巨无霸", category: "mains", image: "https://menu-img.mcd.cn/pcm/prod/menu/20260309/product/MS_1100_320.png", groups: ["人气热卖"] },
  { code: "fries", name: "中薯条", category: "snacks" },
] };
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "maimai-table-test-"));
  const path = join(directory, "tables.sqlite");
  const owner = new SharedTables(path); const gateway = new SharedTables(path);
  t.after(() => {
    owner.close(); gateway.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("maimai-table-test-")) throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true });
  });
  const created = owner.action({ action: "create", title: "一起吃午餐", capacity: 2, name: "发起人", budgetCents: 6000, catalog }, "local-owner");
  const joinGuest = (actor = "guest:one") => gateway.action({ action: "join", id: created.id, invite: created.invite, name: "朋友", budgetCents: 4500 }, actor);
  return { owner, gateway, created, joinGuest, path };
}

const checkoutRef = (table: SharedTable, memberIds: string[]) => sharedCheckoutRef({ ...table, managementRevision: table.managementRevision ?? 0, members: table.members.filter(m => memberIds.includes(m.id)) });

test("reopening lets the host choose capacity, rejects shrinking below members, and survives a second connection", t => {
  const f = fixture(t); let table = f.joinGuest();
  table = f.owner.action({ action: "close", id: table.id, revision: table.revision, closed: true }, "local-owner");
  const reopen = { action: "close", id: table.id, revision: table.revision, closed: false, capacity: 5 };
  assert.throws(() => f.gateway.action(reopen, "guest:one"), /只有发起人/);
  for (const capacity of [0, 1, 7, 2.5]) assert.throws(() => f.owner.action({ ...reopen, capacity }, "local-owner"));
  table = f.owner.action(reopen, "local-owner");
  assert.equal(table.capacity, 5);
  assert.equal(f.gateway.action({ action: "read", id: table.id }, "guest:one").capacity, 5);
  table = f.gateway.action({ action: "join", id: table.id, invite: f.created.invite, name: "第三人", budgetCents: 5000 }, "guest:two");
  assert.throws(() => f.owner.action({ ...reopen, revision: table.revision, capacity: 2 }, "local-owner"), /名额不能小于/);
  assert.equal(f.owner.action({ action: "read", id: table.id }, "local-owner").capacity, 5);
});

test("host can remove a member while closed or expired, freeing a seat and revoking old access", t => {
  const f = fixture(t); let table = f.joinGuest(); const friendId = table.myMemberId;
  const remove = { action: "remove", id: table.id, revision: table.revision, memberId: friendId };
  assert.throws(() => f.gateway.action(remove, "guest:one"), /只有发起人/);
  assert.throws(() => f.owner.action({ ...remove, memberId: f.created.myMemberId }, "local-owner"), /不能移除/);
  assert.throws(() => f.owner.action({ ...remove, revision: 0 }, "local-owner"), /已更新/);
  table = f.owner.action({ action: "close", id: table.id, revision: table.revision, closed: true }, "local-owner");
  table = f.owner.action({ ...remove, revision: table.revision }, "local-owner", table.expiresAt + 1);
  assert.equal(table.members.length, 1);
  assert.equal(JSON.stringify(table).includes("guest:one"), false);
  assert.equal("removedActors" in table, false);
  assert.throws(() => f.gateway.action({ action: "read", id: table.id }, "guest:one"), /移出/);
  assert.throws(() => f.gateway.validateInvitation(table.id, f.created.invite!, "guest:one"), /移出/);
  table = f.owner.action({ action: "close", id: table.id, revision: table.revision, closed: false, capacity: 2 }, "local-owner");
  assert.throws(() => f.joinGuest(), /移出/);
  assert.equal(f.joinGuest("guest:new").members.length, 2);
});

test("one ready member may check out; unselected edits do not invalidate that batch, selected edits do", t => {
  const f = fixture(t); const joined = f.joinGuest();
  let table = f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [{ code: "burger", quantity: 1 }], ready: true }, "guest:one");
  const ref = checkoutRef(table, [joined.myMemberId]);
  assert.deepEqual(f.owner.checkCheckout(ref, "local-owner", { storeCode: "12345", selections: [{ productCode: "burger" }] }), ["朋友"]);
  assert.throws(() => f.gateway.checkCheckout(ref, "guest:one"), /已变化/);
  assert.throws(() => f.owner.checkCheckout(checkoutRef(table, [f.created.myMemberId]), "local-owner"), /已变化/);
  assert.throws(() => f.owner.checkCheckout({ ...ref, members: [...ref.members, ...ref.members] }, "local-owner"));
  for (const order of [{ storeCode: "999", selections: [{ productCode: "burger" }] }, { storeCode: "12345", selections: [{ productCode: "fries" }] }, { storeCode: "12345", selections: [{ productCode: "burger" }, { productCode: "burger" }] }]) assert.throws(() => f.owner.checkCheckout(ref, "local-owner", order), /餐单与/);
  table = f.owner.action({ action: "update", id: joined.id, revision: 0, name: "发起人", budgetCents: 7000, picks: [], ready: false }, "local-owner");
  assert.equal(sharedSelectionCurrent(table, ref), true);
  f.owner.checkCheckout(ref, "local-owner");
  table = f.gateway.action({ action: "update", id: joined.id, revision: 1, name: "朋友", budgetCents: 5500, picks: [{ code: "burger", quantity: 2 }], ready: true }, "guest:one");
  assert.equal(sharedSelectionCurrent(table, ref), false);
  assert.throws(() => f.owner.checkCheckout(ref, "local-owner"), /已变化/);
});

test("shared submission reserves only selected meals and rejects duplicate submission and stale lifecycle", t => {
  const f = fixture(t); const joined = f.joinGuest();
  let table = f.owner.action({ action: "update", id: joined.id, revision: 0, name: "发起人", budgetCents: 6000, picks: [{ code: "burger", quantity: 1 }], ready: true }, "local-owner");
  const oldRef = checkoutRef(table, [f.created.myMemberId]);
  table = f.owner.action({ action: "close", id: table.id, revision: table.revision, closed: true }, "local-owner");
  assert.throws(() => f.owner.checkCheckout(oldRef, "local-owner"), /已变化/);
  table = f.owner.action({ action: "close", id: table.id, revision: table.revision, closed: false, capacity: 3 }, "local-owner");
  assert.throws(() => f.owner.checkCheckout(oldRef, "local-owner"), /已变化/);
  const ref = checkoutRef(table, [f.created.myMemberId]);
  f.owner.claimCheckout(ref, "local-owner");
  assert.throws(() => f.gateway.claimCheckout(ref, "local-owner"), /已变化/);
  table = f.gateway.action({ action: "read", id: table.id }, "guest:one");
  assert.equal(table.members.find(m => m.host)!.submitted, true);
  assert.equal(table.members.find(m => !m.host)!.submitted, undefined);
  assert.throws(() => f.owner.action({ action: "update", id: table.id, revision: 1, name: "发起人", budgetCents: 1000, picks: [], ready: false }, "local-owner"), /已提交/);
  table = f.gateway.action({ action: "update", id: table.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [{ code: "fries", quantity: 6 }, { code: "burger", quantity: 6 }], ready: true }, "guest:one");
  f.owner.checkCheckout(checkoutRef(table, [joined.myMemberId]), "local-owner");
});
test("separate server connections share committed choices and budgets, preserving each member's changes", t => {
  const f = fixture(t); const joined = f.joinGuest();
  assert.equal(joined.catalog.items[0].image, catalog.items[0].image);
  assert.deepEqual(joined.catalog.items[0].groups, ["人气热卖"]);
  const friend = f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "朋友", budgetCents: 7800, picks: [{ code: "burger", quantity: 2 }], ready: true }, "guest:one");
  const host = f.owner.action({ action: "update", id: joined.id, revision: 0, name: "发起人", budgetCents: 5000, picks: [{ code: "fries", quantity: 1 }], ready: true }, "local-owner");
  assert.equal(host.members.find(m => m.id === friend.myMemberId)!.budgetCents, 7800);
  assert.deepEqual(host.members.find(m => m.id === friend.myMemberId)!.picks, [{ code: "burger", quantity: 2 }]);
  assert.equal(host.members.every(m => m.ready), true);
  assert.equal(host.revision, 4);
  assert.equal(f.gateway.action({ action: "read", id: host.id }, "guest:one").revision, 4);
  assert.equal(host.invite, undefined); assert.equal(JSON.stringify(host).includes("guest:one"), false);
  assert.equal(readFileSync(f.path).includes(Buffer.from(f.created.invite!)), false);
});
test("invitation, membership, host authority and capacity are enforced", t => {
  const f = fixture(t);
  assert.throws(() => f.gateway.action({ action: "read", id: f.created.id }, "guest:one"), /先通过餐桌邀请/);
  assert.throws(() => f.gateway.action({ action: "join", id: f.created.id, invite: "x".repeat(32), name: "朋友", budgetCents: 1000 }, "guest:one"), /邀请码/);
  const joined = f.joinGuest();
  assert.equal(f.joinGuest().members.length, 2);
  assert.throws(() => f.joinGuest("guest:two"), /满员/);
  assert.throws(() => f.gateway.action({ action: "close", id: joined.id, revision: joined.revision, closed: true }, "guest:one"), /只有发起人/);
  assert.throws(() => f.gateway.action({ action: "update", id: joined.id, memberId: f.created.myMemberId, revision: 0, name: "冒充", budgetCents: 1000, picks: [], ready: false }, "guest:one"));
  assert.throws(() => f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "冒充", budgetCents: 1000, picks: [], ready: false }, "guest:outsider"), /先通过餐桌邀请/);
});
test("stale edits cannot overwrite a member, and invalid/oversized meal choices are atomic", t => {
  const f = fixture(t); f.joinGuest();
  const input = { action: "update", id: f.created.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [{ code: "burger", quantity: 6 }, { code: "fries", quantity: 6 }], ready: true };
  f.gateway.action(input, "guest:one");
  assert.throws(() => f.gateway.action(input, "guest:one"), /另一页面/);
  assert.throws(() => f.owner.action({ ...input, name: "发起人", picks: [{ code: "fries", quantity: 1 }] }, "local-owner"), /12/);
  assert.throws(() => f.owner.action({ ...input, picks: [] }, "local-owner"), /昵称/);
  assert.throws(() => f.gateway.action({ ...input, revision: 1, picks: [{ code: "unknown", quantity: 1 }] }, "guest:one"), /不属于/);
  assert.throws(() => f.gateway.action({ ...input, revision: 1, picks: [], ready: true }, "guest:one"), /先选/);
  assert.equal(f.gateway.action({ action: "read", id: f.created.id }, "guest:one").members.find(m => !m.host)!.revision, 1);
});
test("closed and expired tables reject modifications; host can reopen without losing choices", t => {
  const f = fixture(t); const joined = f.joinGuest();
  const closed = f.owner.action({ action: "close", id: joined.id, revision: joined.revision, closed: true }, "local-owner");
  assert.throws(() => f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [], ready: false }, "guest:one"), /已关闭/);
  assert.throws(() => f.owner.action({ action: "close", id: joined.id, revision: joined.revision, closed: false }, "local-owner"), /已更新/);
  assert.equal(f.owner.action({ action: "close", id: joined.id, revision: closed.revision, closed: false }, "local-owner").closed, false);
  assert.equal(f.gateway.action({ action: "read", id: joined.id }, "guest:one", joined.expiresAt + 10000).members.length, 2);
});

test("expired tables retain member access and only the host can reopen them for another 24 hours", t => {
  const f = fixture(t); const joined = f.joinGuest();
  const saved = f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "朋友", budgetCents: 7800, picks: [{ code: "burger", quantity: 2 }], ready: true }, "guest:one");
  const now = saved.expiresAt + 1000;
  const read = f.gateway.action({ action: "read", id: saved.id }, "guest:one", now);
  assert.deepEqual(read.members, saved.members);
  assert.throws(() => f.owner.action({ action: "read", id: saved.id }, "stranger", now), /先通过餐桌邀请/);
  assert.throws(() => f.gateway.action({ action: "update", id: saved.id, revision: 1, name: "朋友", budgetCents: 1000, picks: [], ready: false }, "guest:one", now), /24 小时/);
  assert.throws(() => f.gateway.action({ action: "close", id: saved.id, revision: saved.revision, closed: false }, "guest:one", now), /只有发起人/);
  assert.throws(() => f.gateway.validateInvitation(saved.id, f.created.invite!, undefined, now), /过期/);
  const closed = f.owner.action({ action: "close", id: saved.id, revision: saved.revision, closed: true }, "local-owner", now);
  assert.equal(closed.closed, true);
  assert.throws(() => f.owner.action({ action: "close", id: saved.id, revision: saved.revision, closed: false }, "local-owner", now), /已更新/);
  const reopened = f.owner.action({ action: "close", id: saved.id, revision: closed.revision, closed: false }, "local-owner", now);
  assert.equal(reopened.closed, false);
  assert.equal(reopened.id, saved.id);
  assert.equal(reopened.expiresAt, now + 86400000);
  assert.deepEqual(reopened.members, saved.members);
  assert.deepEqual(reopened.catalog, saved.catalog);
  assert.equal(f.gateway.action({ action: "read", id: saved.id }, "guest:one", now).closed, false);
  f.gateway.validateInvitation(saved.id, f.created.invite!, "guest:one", now);
  const repeated = f.owner.action({ action: "close", id: saved.id, revision: reopened.revision, closed: false }, "local-owner", now + 1000);
  assert.equal(repeated.expiresAt, reopened.expiresAt);
});

test("host can add prices to an existing shared table across connections without changing member choices", t => {
  const f = fixture(t); const joined = f.joinGuest();
  assert.equal(joined.catalog.items[0].menuPriceCents, undefined);
  const saved = f.gateway.action({ action: "update", id: joined.id, revision: 0, name: "朋友", budgetCents: 4500, picks: [{ code: "burger", quantity: 1 }], ready: true }, "guest:one");
  const update = { action: "prices", id: joined.id, revision: saved.revision, storeCode: catalog.storeCode, prices: [{ code: "burger", menuPriceCents: 2650 }, { code: "fries", menuPriceCents: 0 }] };
  const changed = f.owner.action(update, "local-owner");
  assert.deepEqual(changed.members, saved.members);
  assert.equal(changed.revision, saved.revision + 1);
  const otherDevice = f.gateway.action({ action: "read", id: joined.id }, "guest:one");
  assert.deepEqual(otherDevice.catalog.items.map(i => i.menuPriceCents), [2650, 0]);
  assert.equal(otherDevice.catalog.items[0].image, catalog.items[0].image);
  assert.deepEqual(otherDevice.catalog.items[0].groups, catalog.items[0].groups);
  assert.throws(() => f.owner.action(update, "local-owner"), /已更新/);
  const unknown = f.owner.action({ ...update, revision: changed.revision, prices: [{ code: "burger", menuPriceCents: null }] }, "local-owner");
  assert.equal(unknown.catalog.items[0].menuPriceCents, undefined);
  assert.equal(unknown.catalog.items[1].menuPriceCents, 0);
});

test("price updates require host authority, matching store, valid items and an open table", t => {
  const f = fixture(t); const joined = f.joinGuest();
  const update = { action: "prices", id: joined.id, revision: joined.revision, storeCode: catalog.storeCode, prices: [{ code: "burger", menuPriceCents: 2650 }] };
  assert.throws(() => f.gateway.action(update, "guest:one"), /只有发起人/);
  assert.throws(() => f.gateway.action(update, "guest:outsider"), /先通过餐桌邀请/);
  assert.throws(() => f.owner.action({ ...update, storeCode: "999" }, "local-owner"), /当前餐桌门店/);
  assert.throws(() => f.owner.action({ ...update, prices: [{ code: "unknown", menuPriceCents: 100 }] }, "local-owner"), /不属于本桌/);
  assert.throws(() => f.owner.action({ ...update, prices: [...update.prices, ...update.prices] }, "local-owner"));
  assert.throws(() => f.owner.action({ ...update, prices: [{ code: "burger", menuPriceCents: -100 }] }, "local-owner"));
  const closed = f.owner.action({ action: "close", id: joined.id, revision: joined.revision, closed: true }, "local-owner");
  assert.throws(() => f.owner.action({ ...update, revision: closed.revision }, "local-owner"), /已关闭/);
});
