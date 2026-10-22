import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { LocalDataError } from "./local-database.ts";
import { McdReadOnlyClient } from "../providers/mcd-readonly.ts";
import { QuoteSelections, type QuoteSelection } from "../providers/mcd-quote.ts";
import { orderTool, parseCreatedOrder, parseOrderStatus } from "../providers/mcd-orders.ts";
import type { CheckoutView } from "../domain/checkout.ts";
import { SharedCheckout, type SharedCheckoutRef } from "../domain/shared-table.ts";

const Id = z.string().regex(/^[a-f0-9]{32}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), storeCode: z.string().regex(/^\d{1,20}$/), selections: QuoteSelections.refine(rows => rows.every(r => !!r.configurationKey)), expectedCents: z.number().int().nonnegative(), shared: SharedCheckout.optional() }).strict(),
  z.object({ action: z.literal("confirm"), id: Id, takeWayCode: z.string().min(1).max(100), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("read"), id: Id }).strict(),
  z.object({ action: z.literal("refresh"), id: Id }).strict(),
  z.object({ action: z.literal("latest") }).strict(),
]);
type SharedRef = SharedCheckoutRef;
type Stored = CheckoutView & { account: string; selections: QuoteSelection[]; shared?: SharedRef };
export type CheckoutDependencies = {
  prepare: (code: string, selections: QuoteSelection[]) => ReturnType<McdReadOnlyClient["prepareCheckout"]>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  query: (orderId: string) => Promise<unknown>;
  check: (shared?: SharedRef, order?: { storeCode: string; selections: QuoteSelection[] }) => string[] | void;
  claim?: (shared: SharedRef) => void;
};
export function checkoutDependencies(env: Record<string, string | undefined>, check: CheckoutDependencies["check"], claim?: CheckoutDependencies["claim"]): CheckoutDependencies {
  return { check, claim, create: args => orderTool(env, "create-order", args), query: orderId => orderTool(env, "query-order", { orderId }), prepare: async (code, selections) => {
    const client = await McdReadOnlyClient.connect(env);
    try { if (selections.some(s => s.couponRef)) await client.storeCoupons(code); return await client.prepareCheckout(code, selections); }
    finally { await client.close(); }
  } };
}
const unresolved = (row: Stored) => ["submitting", "unknown", "created"].includes(row.state);
// beType=1 only. Drive-through needs a different business code and is not implemented.
const pickupWays = (ways: CheckoutView["takeWays"] | undefined) => (ways ?? []).filter(w => ["堂食", "外带", "到店取餐", "到店自取", "店内自提"].includes(w.title) && !/得来速|车道|外送|配送|团餐/.test(w.subtitle ?? ""));
/** Isolated workspace file, with no token or coupon credentials stored here. */
export class CheckoutStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS checkouts(id TEXT PRIMARY KEY, account TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);");
  }
  close() { this.db.close(); }
  private visible(row: Stored): CheckoutView { const { account: _a, selections: _s, shared: _r, ...view } = row; return view; }
  private read(id: string, account: string) {
    const row = this.db.prepare("SELECT payload FROM checkouts WHERE id=? AND account=?").get(id, account);
    if (!row) throw new LocalDataError("订单记录不存在或属于其他账号。", 404);
    return JSON.parse(row.payload as string) as Stored;
  }
  private active(account: string) {
    return this.db.prepare("SELECT payload FROM checkouts WHERE account=? ORDER BY created_at DESC").all(account).map(row => JSON.parse(row.payload as string) as Stored).find(unresolved);
  }
  private save(row: Stored) { this.db.prepare("UPDATE checkouts SET payload=? WHERE id=?").run(JSON.stringify(row), row.id); }
  async action(raw: unknown, token: string, deps: CheckoutDependencies): Promise<CheckoutView | null> {
    const input = Input.parse(raw); const account = createHash("sha256").update(token).digest("hex");
    deps.check();
    if (input.action === "latest") { const latest = this.active(account); return latest ? this.visible(latest) : null; }
    if (input.action === "prepare") {
      const existing = this.active(account); if (existing) return this.visible(existing);
      deps.check(input.shared, input);
      const { view } = await deps.prepare(input.storeCode, input.selections);
      const memberNames = deps.check(input.shared, input) || undefined;
      if (view.quote.price !== input.expectedCents) throw new LocalDataError("价格已变化，请重新官方核价并确认金额。", 409);
      const takeWays = pickupWays(view.quote.takeWayList);
      if (!takeWays?.length) throw new LocalDataError("官方没有返回可用取餐方式，暂不能创建订单。请在麦当劳 App 核对。", 409);
      const row: Stored = { id: randomBytes(16).toString("hex"), state: "prepared", account, storeCode: input.storeCode, selections: input.selections, shared: input.shared,
        amountCents: view.quote.price, expiresAt: Date.now() + 180000, products: view.quote.productList.map(({ productName, quantity, subtotal }) => ({ productName, quantity, subtotal })), takeWays, memberNames };
      this.db.prepare("INSERT INTO checkouts VALUES(?,?,?,?)").run(row.id, account, JSON.stringify(row), Date.now());
      return this.visible(row);
    }
    let row = this.read(input.id, account);
    if (input.action === "read") return this.visible(row);
    if (input.action === "refresh") {
      if (!row.orderId) return this.visible(row);
      const status = parseOrderStatus(await deps.query(row.orderId), row.orderId);
      deps.check();
      row = this.read(input.id, account);
      Object.assign(row, status);
      if (["2", "4", "6", "7", "8", "10"].includes(status.orderStatus)) { row.state = "finished"; row.payUrl = undefined; }
      this.save(row); return this.visible(row);
    }
    if (row.state !== "prepared") return this.visible(row);
    if (row.expiresAt <= Date.now()) throw new LocalDataError("下单确认已过期，请重新核价。", 409);
    deps.check(row.shared, row);
    const prepared = await deps.prepare(row.storeCode, row.selections);
    deps.check(row.shared, row);
    if (prepared.view.quote.price !== row.amountCents) throw new LocalDataError("价格已变化，未创建订单。请重新核价后确认。", 409);
    if (!row.takeWays.some(t => t.code === input.takeWayCode) || !pickupWays(prepared.view.quote.takeWayList).some(t => t.code === input.takeWayCode)) throw new LocalDataError("取餐方式已变化，请重新核价。", 409);
    // Persist a single-use claim before any write reaches McDonald's. A crash is not a retry signal.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      row = this.read(input.id, account);
      if (row.state !== "prepared") { this.db.exec("COMMIT"); return this.visible(row); }
      if (row.expiresAt <= Date.now()) throw new LocalDataError("下单确认已过期，请重新核价。", 409);
      const active = this.active(account); if (active) { this.db.exec("COMMIT"); return this.visible(active); }
      if (row.shared) {
        if (!deps.claim) throw new LocalDataError("共享下单服务未就绪，请稍后重试。", 503);
        deps.claim(row.shared);
      }
      row.state = "submitting"; this.save(row); this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    try {
      // Only this line may create an order. There is deliberately no retry.
      const created = parseCreatedOrder(await deps.create({ ...prepared.request, takeWayCode: input.takeWayCode }));
      Object.assign(row, created, { state: "created" }); this.save(row);
    } catch { row.state = "unknown"; this.save(row); }
    // Keep a recoverable record even if the browser disconnected during creation.
    return this.visible(row);
  }
}
