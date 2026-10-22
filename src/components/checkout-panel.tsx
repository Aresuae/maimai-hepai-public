"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ExternalLink, X } from "lucide-react";
import type { CheckoutView } from "../domain/checkout";
import type { LiveCartLine, LiveQuote } from "../domain/live-menu";
import { formatMoney } from "../domain/money";
import type { SharedCheckoutRef } from "../domain/shared-table";

const statusLabels: Record<string, string> = { "1": "待支付", "2": "已支付，配餐中", "4": "配送中", "6": "已完成", "7": "已取消", "8": "已评价", "10": "餐厅配餐中" };
export function CheckoutPanel({ cart, fresh, enabled, storeName, storeAddress, accountRevision, cartKey, shared }: {
  cart: LiveCartLine[]; fresh: LiveQuote | null; enabled: boolean; storeName: string; storeAddress: string;
  accountRevision: number; cartKey: string; shared?: SharedCheckoutRef;
}) {
  const [order, setOrder] = useState<CheckoutView | null>(null);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [takeWay, setTakeWay] = useState(""); const [agreed, setAgreed] = useState(false);
  const preparedKey = useRef(""); const latestKey = useRef(cartKey); latestKey.current = cartKey;
  async function api(body: Record<string, unknown>): Promise<CheckoutView | null> {
    const response = await fetch("/api/checkout", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Maimai-Account-Version": String(accountRevision) }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "code" in data && data.code === "SHARE_LOGIN_REQUIRED") globalThis.dispatchEvent(new Event("maimai-access-expired"));
    if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "订单服务暂不可用。");
    return data as CheckoutView | null;
  }
  useEffect(() => {
    let disposed = false;
    void api({ action: "latest" }).then(row => { if (!disposed && row) setOrder(row); }).catch(() => {});
    return () => { disposed = true; };
  }, [accountRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  async function prepare() {
    if (!fresh || !enabled || busy) return;
    setBusy(true); setError(""); setAgreed(false);
    const key = cartKey;
    try {
      const next = await api({ action: "prepare", storeCode: fresh.storeCode, expectedCents: fresh.quote.price,
        selections: cart.map(({ productCode, couponRef, configurationKey }) => ({ productCode, configurationKey, ...(couponRef ? { couponRef } : {}) })), ...(shared ? { shared } : {}) });
      if (latestKey.current !== key && next?.state === "prepared") throw new Error("餐单已变化，请重新核价。");
      setOrder(next); preparedKey.current = key; setTakeWay(""); setOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "无法准备订单。"); }
    finally { setBusy(false); }
  }
  async function act(action: "confirm" | "refresh" | "read") {
    if (!order || busy) return;
    setBusy(true); setError("");
    try {
      if (action === "confirm" && (!enabled || preparedKey.current !== latestKey.current || !agreed || !takeWay)) throw new Error("餐单或确认状态已变化，请重新核价后确认。");
      const next = await api({ action, id: order.id, ...(action === "confirm" ? { confirmed: true, takeWayCode: takeWay } : {}) });
      setOrder(next);
    } catch (e) {
      setError(action === "confirm" ? `${e instanceof Error ? e.message : "提交未能确认结果。"} 请先恢复订单状态并在麦当劳 App 检查，勿重复下单。` : e instanceof Error ? e.message : "查询失败。");
      if (action === "confirm") { try { setOrder(await api({ action: "read", id: order.id })); } catch { /* Manual recovery remains available. */ } }
    } finally { setBusy(false); }
  }
  const pending = order && order.state !== "prepared";
  const detail = order && <>
    {order.memberNames?.length ? <p className="checkout-members"><strong>本次结算成员：</strong>{order.memberNames.join("、")}<br /><small>仅包含这些成员的餐品，由发起人当前连接的账号统一付款。</small></p> : null}
    {order.state === "prepared" ? <>
      <p><strong>{storeName}</strong><br /><span className="setting-hint">{storeAddress} · 现在下单，到店自取</span></p>
      <ul>{cart.map(line => <li key={line.id}>{line.name} ×1{line.parts.length > 0 && <small className="setting-hint"> · {line.parts.join("、")}</small>}</li>)}</ul>
      <p className="checkout-total">整单应付 <strong>{formatMoney(order.amountCents)}</strong></p>
      <label className="checkout-label">取餐方式<select value={takeWay} onChange={e => setTakeWay(e.target.value)} disabled={busy}><option value="">请选择官方返回的取餐方式</option>{order.takeWays.map(w => <option value={w.code} key={w.code}>{w.title}{w.subtitle ? ` · ${w.subtitle}` : ""}</option>)}</select></label>
      <label className="checkout-consent"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} disabled={busy} /><span>我已核对门店、餐品、取餐方式和金额，确认用当前连接的麦当劳账号创建真实订单。</span></label>
      <p className="setting-hint">由当前账号支付整单；页面分账是朋友之间的结算参考。创建订单可能占用所选账户券；支付在官方页面由你完成。</p>
      {(!enabled || preparedKey.current !== cartKey) && <p className="error-notice">餐单、预算或共享餐桌已变化，或报价已过期。请关闭此窗口，重新汇总并核价。</p>}
      <button className="primary-button" disabled={busy || !agreed || !takeWay || !enabled || preparedKey.current !== cartKey} onClick={() => void act("confirm")}>{busy ? "正在处理…" : `确认下单 · ${formatMoney(order.amountCents)}`}</button>
    </> : <>
      <p>{order.orderId ? `订单号：${order.orderId}` : "下单请求结果待核实"}</p>
      <p>{order.orderStatus ? statusLabels[order.orderStatus] ?? "请在官方 App 查看最新状态" : order.state === "created" ? "订单已创建，支付状态待查询" : "请求可能已到达官方。为避免重复订单，已暂停本账号继续下单，请在麦当劳 App 核实。"}</p>
      {order.expirePayTime && <p>官方支付截止：{order.expirePayTime}</p>}
      {order.pickupCode && <p><strong>取餐码：{order.pickupCode}</strong></p>}
      {order.payUrl && order.state === "created" && <a className="primary-button" href={order.payUrl} target="_blank" rel="noopener noreferrer">打开官方支付页面 <ExternalLink size={16} /></a>}
      {order.state === "created" && !order.payUrl && <p className="setting-hint">暂未得到可直接打开的官方支付链接，请打开麦当劳 App，在「我的订单」支付。</p>}
      <button className="outline-button" disabled={busy} onClick={() => void act(order.orderId ? "refresh" : "read")}>{busy ? "查询中…" : order.orderId ? "我已支付 / 查询订单状态" : "恢复订单状态"}</button>
      {order.state === "finished" && <button className="text-button" onClick={() => { setOrder(null); setOpen(false); }}>关闭此订单，返回选餐</button>}
    </>}
  </>;
  return <section className="checkout-panel" aria-label="下单与支付">
    <strong>下一步 · 官方下单与支付</strong>
    <p className="setting-hint">{pending ? "当前账号有一笔待处理的订单记录。请先查看并查询结果，处理完成后再提交下一单，避免重复下单。" : "核价后可查看下单确认页。只有你确认提交，才会创建真实订单。"}</p>
    <button className="primary-button" disabled={busy || (!pending && !enabled)} onClick={() => pending ? setOpen(true) : void prepare()}>{busy ? "正在复核订单…" : pending ? "查看我的订单与支付" : "去下单确认"}</button>
    {error && !open && <p role="alert" className="error-notice">{error}</p>}
    <Dialog.Root open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><Dialog.Portal><Dialog.Overlay className="checkout-overlay" /><Dialog.Content className="checkout-dialog">
      <Dialog.Title>{pending ? "订单与支付" : "确认这份真实订单"}</Dialog.Title><Dialog.Description>核对完成后再提交。支付结果以官方查询为准。</Dialog.Description><Dialog.Close className="dialog-close" aria-label="关闭下单窗口" disabled={busy}><X size={20} /></Dialog.Close>
      {detail}{error && <p role="alert" className="error-notice">{error}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
