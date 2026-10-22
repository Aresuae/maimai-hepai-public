import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { SharedCatalog, SharedPicks, SharedCheckout, sharedSelectionCurrent, type SharedCheckoutRef, type SharedTable, type SharedMember } from "../domain/shared-table.ts";
import { LocalDataError } from "./local-database.ts";

const id = z.string().regex(/^[a-f0-9]{24}$/);
const Name = z.string().trim().min(1).max(12);
const Budget = z.number().int().min(100).max(100000);
const Prices = z.array(z.object({ code: z.string().min(1).max(80), menuPriceCents: z.number().int().min(0).max(1000000).nullable() }).strict()).min(1).max(500)
  .refine(items => new Set(items.map(item => item.code)).size === items.length, "餐品不能重复");
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(1).max(40), capacity: z.number().int().min(2).max(6), name: Name, budgetCents: Budget, catalog: SharedCatalog }).strict(),
  z.object({ action: z.literal("join"), id, invite: z.string().regex(/^[A-Za-z0-9_-]{32}$/), name: Name, budgetCents: Budget }).strict(),
  z.object({ action: z.literal("read"), id }).strict(),
  z.object({ action: z.literal("update"), id, revision: z.number().int().nonnegative(), name: Name, budgetCents: Budget, picks: SharedPicks, ready: z.boolean() }).strict(),
  z.object({ action: z.literal("close"), id, revision: z.number().int().nonnegative(), closed: z.boolean(), capacity: z.number().int().min(2).max(6).optional() }).strict(),
  z.object({ action: z.literal("remove"), id, revision: z.number().int().nonnegative(), memberId: id }).strict(),
  z.object({ action: z.literal("prices"), id, revision: z.number().int().nonnegative(), storeCode: z.string().regex(/^\d{1,20}$/), prices: Prices }).strict(),
]);
type StoredMember = SharedMember & { actor: string };
type StoredTable = Omit<SharedTable, "members" | "myMemberId" | "isHost" | "invite" | "publicOrigin"> & { members: StoredMember[]; removedActors?: string[] };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Public meal choices only. No account token, coupon code/ref, payment link or private account data. */
export class SharedTables {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS shared_tables(id TEXT PRIMARY KEY, invite_hash TEXT NOT NULL, payload TEXT NOT NULL);");
  }
  close() { this.db.close(); }
  private transaction<T>(f: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = f(); this.db.exec("COMMIT"); return result; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  private row(tableId: string) {
    const row = this.db.prepare("SELECT invite_hash,payload FROM shared_tables WHERE id=?").get(tableId) as { invite_hash: string; payload: string } | undefined;
    if (!row) throw new LocalDataError("餐桌不存在，请检查邀请链接。", 404);
    return { ...row, table: JSON.parse(row.payload) as StoredTable };
  }
  private visible(table: StoredTable, actor: string): SharedTable {
    const member = table.members.find(m => m.actor === actor);
    if (!member) throw new LocalDataError("请先通过餐桌邀请加入。", 403);
    const { removedActors: _removed, ...publicTable } = table;
    return { ...publicTable, members: table.members.map(({ actor: _actor, ...m }) => m), myMemberId: member.id, isHost: member.host };
  }
  checkCheckout(raw: SharedCheckoutRef, actor: string, order?: { storeCode: string; selections: { productCode: string }[] }) {
    const ref = SharedCheckout.parse(raw);
    const table = this.visible(this.row(ref.id).table, actor);
    if (!table.isHost || !sharedSelectionCurrent(table, ref)) throw new LocalDataError("本次结算的成员或餐桌已变化，请重新选择成员并核价。", 409);
    const members = ref.members.map(selected => table.members.find(m => m.id === selected.id)!);
    if (order) {
      const expected = members.flatMap(m => m.picks.flatMap(p => Array<string>(p.quantity).fill(p.code))).sort();
      const actual = order.selections.map(p => p.productCode).sort();
      if (order.storeCode !== table.catalog.storeCode || JSON.stringify(actual) !== JSON.stringify(expected)) throw new LocalDataError("餐单与本次所选成员不一致，请重新汇总后核价。", 409);
    }
    return members.map(m => m.name);
  }
  /** Reserve only the selected meals before the first upstream write, even if its result is unknown. */
  claimCheckout(ref: SharedCheckoutRef, actor: string) {
    this.transaction(() => {
      this.checkCheckout(ref, actor);
      const table = this.row(ref.id).table;
      for (const m of table.members) if (ref.members.some(s => s.id === m.id)) m.submitted = true;
      table.revision++;
      this.db.prepare("UPDATE shared_tables SET payload=? WHERE id=?").run(JSON.stringify(table), table.id);
    });
  }
  /** Validates a table-scoped invitation before granting an isolated visitor workspace.
   * Does not join, reserve a seat, expose the catalog or grant the host's identity. */
  validateInvitation(tableId: string, invite: string, actor?: string, now = Date.now()) {
    id.parse(tableId);
    z.string().regex(/^[A-Za-z0-9_-]{32}$/).parse(invite);
    const row = this.row(tableId); const table = row.table;
    if (actor && table.removedActors?.includes(actor)) throw new LocalDataError("你已被移出这张餐桌，请联系发起人。", 403);
    if (!timingSafeEqual(Buffer.from(row.invite_hash, "hex"), Buffer.from(hash(invite), "hex"))) throw new LocalDataError("餐桌邀请链接不正确，请向发起人重新获取。", 403);
    if (table.expiresAt <= now) throw new LocalDataError("这张餐桌的邀请已过期，请让发起人重新开桌。", 410);
    if (!table.members.some(member => member.actor === actor)) {
      if (table.closed) throw new LocalDataError("发起人已关闭这张餐桌。", 409);
      if (table.members.length >= table.capacity) throw new LocalDataError("这张餐桌已经满员。", 409);
    }
  }
  action(raw: unknown, actor: string, now = Date.now()): SharedTable {
    const input = Input.parse(raw);
    if (!actor) throw new LocalDataError("需要有效身份。", 401);
    return this.transaction(() => {
      if (input.action === "create") {
        if (Number(this.db.prepare("SELECT count(*) AS n FROM shared_tables").get()!.n) >= 500) throw new LocalDataError("当前内测餐桌数已达上限。", 429);
        const invite = randomBytes(24).toString("base64url");
        const table: StoredTable = { id: randomBytes(12).toString("hex"), title: input.title, capacity: input.capacity, revision: 1, closed: false, expiresAt: now + 86400000, catalog: input.catalog,
          members: [{ id: randomBytes(12).toString("hex"), actor, name: input.name, budgetCents: input.budgetCents, revision: 0, picks: [], ready: false, host: true }] };
        this.db.prepare("INSERT INTO shared_tables VALUES(?,?,?)").run(table.id, hash(invite), JSON.stringify(table));
        return { ...this.visible(table, actor), invite };
      }
      const row = this.row(input.id); const table = row.table;
      // Members can still inspect their records and the host can reopen an expired table.
      if (table.removedActors?.includes(actor)) throw new LocalDataError("你已被移出这张餐桌，请联系发起人。", 403);
      if (table.expiresAt <= now && !["read", "close", "remove"].includes(input.action)) throw new LocalDataError("餐桌已超过 24 小时有效期，请让发起人重新开启合拍。", 410);
      let mine = table.members.find(m => m.actor === actor);
      if (input.action === "join") {
        if (!timingSafeEqual(Buffer.from(row.invite_hash, "hex"), Buffer.from(hash(input.invite), "hex"))) throw new LocalDataError("餐桌邀请码不正确。", 403);
        if (mine) return this.visible(table, actor);
        if (table.closed) throw new LocalDataError("发起人已关闭这张餐桌。", 409);
        if (table.members.length >= table.capacity) throw new LocalDataError("这张餐桌已经满员。", 409);
        if (table.members.some(m => m.name === input.name)) throw new LocalDataError("这个昵称已在餐桌中，请换一个。", 409);
        mine = { id: randomBytes(12).toString("hex"), actor, name: input.name, budgetCents: input.budgetCents, revision: 0, picks: [], ready: false, host: false };
        table.members.push(mine);
      } else {
        if (!mine) throw new LocalDataError("请先通过餐桌邀请加入。", 403);
        if (input.action === "read") return this.visible(table, actor);
        if (input.action === "prices") {
          if (!mine.host) throw new LocalDataError("只有发起人可以同步菜单价格。", 403);
          if (table.closed) throw new LocalDataError("餐桌已关闭，暂不能更新价格。", 409);
          if (input.revision !== table.revision) throw new LocalDataError("餐桌已更新，请刷新后同步价格。", 409);
          if (input.storeCode !== table.catalog.storeCode) throw new LocalDataError("只能同步当前餐桌门店的价格。");
          if (input.prices.some(p => !table.catalog.items.some(item => item.code === p.code))) throw new LocalDataError("价格中包含不属于本桌的餐品。");
          const prices = new Map(input.prices.map(p => [p.code, p.menuPriceCents]));
          for (const item of table.catalog.items) {
            if (!prices.has(item.code)) continue;
            const price = prices.get(item.code);
            if (price === null) delete item.menuPriceCents;
            else item.menuPriceCents = price;
          }
          table.managementRevision = (table.managementRevision ?? 0) + 1;
        } else if (input.action === "remove") {
          if (!mine.host) throw new LocalDataError("只有发起人可以移除成员。", 403);
          if (input.revision !== table.revision) throw new LocalDataError("餐桌已更新，请刷新后操作。", 409);
          const removed = table.members.find(m => m.id === input.memberId);
          if (!removed || removed.host) throw new LocalDataError("不能移除发起人或不存在的成员。", 409);
          table.removedActors = [...(table.removedActors ?? []), removed.actor];
          table.members = table.members.filter(m => m.id !== removed.id);
          table.managementRevision = (table.managementRevision ?? 0) + 1;
        } else if (input.action === "close") {
          if (!mine.host) throw new LocalDataError("只有发起人可以管理餐桌。", 403);
          if (input.revision !== table.revision) throw new LocalDataError("餐桌已更新，请刷新后操作。", 409);
          if (input.capacity !== undefined) {
            if (input.closed) throw new LocalDataError("请在重新开启时设置名额。");
            if (input.capacity < table.members.length) throw new LocalDataError("名额不能小于当前人数，请先移除多余成员。", 409);
            table.capacity = input.capacity;
          }
          if (!input.closed && (table.closed || table.expiresAt <= now)) table.expiresAt = now + 86400000;
          table.closed = input.closed;
          table.managementRevision = (table.managementRevision ?? 0) + 1;
        } else {
          if (table.closed) throw new LocalDataError("餐桌已关闭，暂不能改餐。", 409);
          if (mine.submitted) throw new LocalDataError("这一份已提交下单，请在订单中查看结果；需要再点餐可另开一桌。", 409);
          if (input.revision !== mine.revision) throw new LocalDataError("你的选择已在另一页面更新，请先载入最新选择。", 409);
          if (table.members.some(m => m.id !== mine!.id && m.name === input.name)) throw new LocalDataError("这个昵称已在餐桌中，请换一个。", 409);
          if (input.picks.some(p => !table.catalog.items.some(item => item.code === p.code))) throw new LocalDataError("有餐品不属于当前餐桌菜单，请重新选择。");
          const total = table.members.filter(m => m.id !== mine!.id && !m.submitted).reduce((n, m) => n + m.picks.reduce((s, p) => s + p.quantity, 0), 0) + input.picks.reduce((n, p) => n + p.quantity, 0);
          if (total > 12) throw new LocalDataError("当前整桌最多选 12 份餐品，请减少后保存。");
          if (input.ready && !input.picks.length) throw new LocalDataError("请先选一份餐品，再标记选好了。");
          Object.assign(mine, { name: input.name, budgetCents: input.budgetCents, picks: input.picks, ready: input.ready, revision: mine.revision + 1 });
        }
      }
      table.revision++;
      this.db.prepare("UPDATE shared_tables SET payload=? WHERE id=?").run(JSON.stringify(table), table.id);
      return this.visible(table, actor);
    });
  }
}
