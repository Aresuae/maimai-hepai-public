"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Coffee,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import type { RoomState } from "../domain/types";
import type { SharedCatalogData, SharedImport } from "../domain/shared-table";
import { sharedCheckoutRef } from "../domain/shared-table";
import type { parseMealDetail, parseMenu } from "../providers/mcd-response";
import {
  allocateLiveQuote,
  type LiveCartLine,
  type LiveQuote,
} from "../domain/live-menu";
import { formatMoney } from "../domain/money";
import { menuDisplayPriceCents } from "../domain/menu-price";
import { BudgetControl } from "./budget-control";
import { CheckoutPanel } from "./checkout-panel";
import { ProductImage } from "./product-image";
import { OfficialMenuCategories } from "./official-menu-categories";
import {
  indexMenuCategories,
  indexOfficialGroups,
  orderedMenuEntries,
  matchesMenuSearch,
  officialCategoryOptions,
} from "../domain/menu-categories";

type Store = {
  storeCode: string;
  storeName: string;
  address: string;
  businessStatus: boolean;
};
type Coupon = {
  ref: string;
  title: string;
  tradeDateTime?: string;
  products: { productCode: string; productName: string }[];
};
type MenuSnapshot = {
  source: "live";
  fetchedAt: number;
  storeCode: string;
  menu: ReturnType<typeof parseMenu>;
  coupons: Coupon[];
};
type Detail = ReturnType<typeof parseMealDetail>;
async function requestApi<T>(body: Record<string, unknown>, accountRevision: number): Promise<T> {
  const response = await fetch("/api/mcd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Maimai-Account-Version": String(accountRevision) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const json: unknown = await response.json().catch(() => null);
  if (json && typeof json === "object" && "code" in json && json.code === "SHARE_LOGIN_REQUIRED") globalThis.dispatchEvent(new Event("maimai-access-expired"));
  if (!response.ok || !json)
    throw new Error(
      json &&
        typeof json === "object" &&
        "error" in json &&
        typeof json.error === "string"
        ? json.error
        : "实时菜单服务暂不可用，请确认分享服务仍在运行。",
    );
  return json as T;
}
const timeText = (value: number) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });

export function LiveMenuPanel({
  room,
  activeId,
  resetKey,
  onBudget,
  accountRevision,
  onCatalog,
  sharedImport,
  sharedChanged = false,
  onImported,
}: {
  room: RoomState;
  activeId: string;
  resetKey: number;
  onBudget: (value: number) => void;
  accountRevision: number;
  onCatalog?: (catalog: SharedCatalogData | null) => void;
  sharedImport?: SharedImport | null;
  sharedChanged?: boolean;
  onImported?: (revision: number | null) => void;
}) {
  const api = <T,>(body: Record<string, unknown>) => requestApi<T>(body, accountRevision);
  const [city, setCity] = useState("");
  const [keyword, setKeyword] = useState("");
  const [stores, setStores] = useState<Store[]>([]);
  const [storeCode, setStoreCode] = useState("");
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [officialGroup, setOfficialGroup] = useState("");
  const [visibleCount, setVisibleCount] = useState(18);
  const [cart, setCart] = useState<LiveCartLine[]>([]);
  const [pending, setPending] = useState<{
    detail: Detail;
    configurationKey: string;
    couponRef?: string;
    memberId: string;
  } | null>(null);
  const [quoted, setQuoted] = useState<{
    key: string;
    result: LiveQuote;
  } | null>(null);
  const [copyText, setCopyText] = useState("");
  const [now, setNow] = useState(Date.now());
  const importFinished = useRef(onImported); importFinished.current = onImported;
  const currentKey = `${storeCode}|${room.revision}|${resetKey}|${JSON.stringify(cart)}`;
  const latestKey = useRef(currentKey);
  latestKey.current = currentKey;
  const active = room.members.find((m) => m.id === activeId)!;
  const store = stores.find((s) => s.storeCode === storeCode);
  const fresh =
    !sharedChanged && quoted?.key === currentKey && now < quoted.result.quotedAt + 300000
      ? quoted.result
      : null;
  let accounting: ReturnType<typeof allocateLiveQuote> | null = null;
  let accountingError = "";
  if (fresh) {
    try {
      accounting = allocateLiveQuote(cart, fresh, room.members, room.payment);
    } catch (error) {
      accountingError = (error as Error).message;
    }
  }
  const categoryOptions = useMemo(() => {
    if (!snapshot) return officialCategoryOptions([]);
    const groups = indexOfficialGroups(snapshot.menu);
    return officialCategoryOptions(orderedMenuEntries(snapshot.menu).map(([code]) => ({ code, groups: groups[code] })), snapshot.menu.categories.map(group => group.name));
  }, [snapshot]);
  const selectedGroup = categoryOptions.some(option => option.value === officialGroup) ? officialGroup : "";
  const mealEntries = (snapshot ? orderedMenuEntries(snapshot.menu, selectedGroup) : []).filter(
    ([, item]) => matchesMenuSearch(item.name, search),
  );
  const categoryLabel = categoryOptions.find(option => option.value === selectedGroup)!.label;
  const displayMessage =
    sharedChanged ? "本次结算的成员或餐桌状态已变化，请返回共享餐桌重新选择成员并核价。" : quoted && !fresh
      ? "餐单、预算已变化，或报价超过本地 5 分钟复核期限，请重新核价。"
      : message;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setCart([]);
    setQuoted(null);
    setPending(null);
    setCopyText("");
    setMessage("");
  }, [resetKey]);
  useEffect(() => {
    setVisibleCount(18);
  }, [search, officialGroup]);
  useEffect(() => {
    if (!snapshot || !store || busy) { onCatalog?.(null); return; }
    const categories = indexMenuCategories(snapshot.menu);
    const groups = indexOfficialGroups(snapshot.menu);
    onCatalog?.({ storeCode, storeName: store.storeName, items: orderedMenuEntries(snapshot.menu).filter(([, item]) => !item.canWithOrder).map(([code, item]) => ({ code, name: item.name, category: categories[code], menuPriceCents: menuDisplayPriceCents(item.currentPrice), ...(item.image ? { image: item.image } : {}), groups: groups[code] ?? [] })) });
  }, [snapshot, storeCode, store?.storeName, onCatalog, busy]);
  useEffect(() => {
    if (!sharedImport) return;
    let disposed = false;
    const draft = sharedImport;
    async function importTable() {
      setBusy("正在读取大家选择的具体餐品与默认搭配…"); setQuoted(null); setCopyText(""); setPending(null); setCart([]);
      try {
        const data = await api<MenuSnapshot>({ action: "menu", storeCode: draft.catalog.storeCode });
        if (disposed) return;
        setStoreCode(draft.catalog.storeCode); setSnapshot(data);
        setStores(current => current.some(s => s.storeCode === draft.catalog.storeCode) ? current : [{ storeCode: draft.catalog.storeCode, storeName: draft.catalog.storeName, address: "共享餐桌所选门店", businessStatus: true }, ...current]);
        const details = new Map<string, { detail: Detail; configurationKey: string }>();
        for (const code of new Set(draft.members.flatMap(m => m.picks.map(p => p.code)))) {
          if (!data.menu.meals[code] || data.menu.meals[code].canWithOrder) throw new Error("有朋友选择的餐品当前已不可售或需要额外购卡，请在共享餐桌修改后重新汇总。");
          details.set(code, await api({ action: "detail", storeCode: draft.catalog.storeCode, productCode: code }));
          if (disposed) return;
        }
        const lines: LiveCartLine[] = [];
        for (const member of draft.members) for (const pick of member.picks) {
          const { detail, configurationKey } = details.get(pick.code)!;
          const parts = detail.rounds?.flatMap(r => r.choices.filter(c => (c.quantity ?? 0) > 0).map(c => `${c.name} ×${c.quantity}`)) ?? [];
          for (let n = 0; n < pick.quantity; n++) lines.push({ id: crypto.randomUUID(), memberId: member.id, productCode: pick.code, name: detail.name, configurationKey, parts });
        }
        setCart(lines); setMessage(`已汇总本次 ${draft.members.length} 人：${draft.members.map(m => m.name).join("、")}。请核对默认搭配，再官方核价；尚未下单。`);
        importFinished.current?.(draft.revision);
      } catch (error) {
        if (!disposed) { setCart([]); setMessage(error instanceof Error ? error.message : "载入失败，请重新汇总。"); importFinished.current?.(null); }
      } finally { if (!disposed) setBusy(""); }
    }
    void importTable();
    return () => { disposed = true; };
  }, [sharedImport]); // Import is explicit; polling must not silently overwrite a reviewed cart.

  async function loadMenu(code: string) {
    setStoreCode(code);
    setSnapshot(null);
    setCart([]);
    setQuoted(null);
    setPending(null);
    setCopyText("");
    setOfficialGroup("");
    setSearch("");
    setBusy("正在读取门店菜单与可用券…");
    const data = await api<MenuSnapshot>({ action: "menu", storeCode: code });
    setSnapshot(data);
    setMessage(
      `已读取 ${Object.keys(data.menu.meals).length} 个真实商品。菜单随门店和时段变化，最终金额以核价为准。`,
    );
  }
  async function searchStores() {
    setBusy("正在查询附近门店…");
    setMessage("");
    setSnapshot(null);
    setCart([]);
    setQuoted(null);
    setStores([]);
    setStoreCode("");
    setPending(null);
    setCopyText("");
    try {
      const data = await api<{ stores: Store[] }>({
        action: "stores",
        city,
        keyword,
      });
      setStores(data.stores);
      const first = data.stores.find((s) => s.businessStatus);
      if (first) await loadMenu(first.storeCode);
      else setMessage("当前没有返回可营业门店，可换一个地标重试。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败，请重试。");
    } finally {
      setBusy("");
    }
  }
  async function chooseStore(code: string) {
    try {
      await loadMenu(code);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function viewProduct(code: string, couponRef?: string) {
    const memberId = activeId;
    setBusy("正在读取具体餐品与默认搭配…");
    setMessage("");
    try {
      const data = await api<{ detail: Detail; configurationKey: string }>({
        action: "detail",
        storeCode,
        productCode: code,
      });
      setPending({
        detail: data.detail,
        configurationKey: data.configurationKey,
        couponRef,
        memberId,
      });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  function addProduct() {
    if (sharedImport) { setPending(null); setMessage("当前为共享结算，请在上方共享餐桌修改餐品并重新汇总。"); return; }
    if (!pending || cart.length >= 12) return;
    if (!room.members.some((m) => m.id === pending.memberId)) {
      setPending(null);
      return;
    }
    if (
      pending.couponRef &&
      cart.some((line) => line.couponRef === pending.couponRef)
    ) {
      setMessage("这张券已在本桌餐单中，每张券只能选一次。");
      setPending(null);
      return;
    }
    const parts =
      pending.detail.rounds?.flatMap((r) =>
        r.choices
          .filter((c) => (c.quantity ?? 0) > 0)
          .map((c) => `${c.name} ×${c.quantity}`),
      ) ?? [];
    setCart((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        memberId: pending.memberId,
        productCode: pending.detail.code,
        name: pending.detail.name,
        couponRef: pending.couponRef,
        parts,
        configurationKey: pending.configurationKey,
      },
    ]);
    setQuoted(null);
    setCopyText("");
    setPending(null);
    setMessage("已加入本桌餐单，点击官方核价查看实际金额。");
  }
  async function quote() {
    if (sharedChanged) return;
    const key = currentKey;
    setQuoted(null);
    setCopyText("");
    setBusy("正在请求官方核价…");
    setMessage("");
    try {
      const result = await api<LiveQuote>({
        action: "quote",
        storeCode,
        selections: cart.map(
          ({ productCode, couponRef, configurationKey }) => ({
            productCode,
            configurationKey,
            ...(couponRef ? { couponRef } : {}),
          }),
        ),
      });
      if (latestKey.current !== key) {
        setMessage("餐单或预算已变化，本次返回作废，请重新核价。");
        return;
      }
      allocateLiveQuote(cart, result, room.members, room.payment);
      setNow(Date.now());
      setQuoted({ key, result });
      setMessage("官方核价完成。这里只生成餐单与报价，尚未创建订单。");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    if (
      !fresh ||
      !accounting ||
      accounting.conflicts.length ||
      Date.now() >= fresh.quotedAt + 300000
    )
      return;
    const text = [
      "麦麦合拍 · 已核价餐单（未下单）",
      `${store?.storeName} · 到店自取`,
      ...room.members.flatMap((m) => [
        m.name,
        ...cart
          .filter((l) => l.memberId === m.id)
          .map(
            (l) =>
              `  ${l.name} ×1${l.couponRef ? " · 用券" : ""}${l.parts.length ? `（${l.parts.join("、")}）` : ""}`,
          ),
        `  分摊 ${formatMoney(accounting!.allocations.find((a) => a.memberId === m.id)!.payableCents)}`,
      ]),
      `官方总额 ${formatMoney(fresh.quote.price)} · ${timeText(fresh.quotedAt)} 核价`,
      "分摊按商品小计比例；同编码商品均分；仅本次报价，不保证后续价格。",
    ].join("\n");
    setCopyText(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制已核价清单。它不是订单或支付凭证。");
    } catch {
      setMessage("可从下方文本框手动复制。");
    }
  }

  return (
    <div className="live-menu-panel">
      <section className="store-picker" aria-label="选择真实门店">
        <div className="live-section-heading">
          <div>
            <span className="eyebrow">REAL MENU, YOUR TABLE</span>
            <h3>
              <MapPin size={19} /> 先选门店，再看具体吃什么
            </h3>
          </div>
          <span className="live-tag">真实菜单 · 到店自取</span>
        </div>
        <div className="store-search">
          <label>
            城市
            <input
              aria-label="城市"
              placeholder="例如：上海市"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!!busy}
            />
          </label>
          <label>
            商场或地标
            <input
              aria-label="门店搜索地标"
              placeholder="例如：人民广场"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              disabled={!!busy}
            />
          </label>
          <button
            className="primary-button"
            disabled={!!busy || !city.trim() || !keyword.trim()}
            onClick={searchStores}
          >
            <Search size={16} /> 查找门店
          </button>
        </div>
        {stores.length > 0 && (
          <label className="store-select">
            本桌取餐门店
            <select
              aria-label="真实取餐门店"
              value={storeCode}
              disabled={!!busy}
              onChange={(e) => chooseStore(e.target.value)}
            >
              {stores.map((s) => (
                <option
                  key={s.storeCode}
                  value={s.storeCode}
                  disabled={!s.businessStatus}
                >
                  {s.storeName}
                  {!s.businessStatus ? "（暂不可用）" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {store && (
          <p className="setting-hint">
            {store.address} · 切换门店或刷新菜单会清空当前餐单。
          </p>
        )}
        <p role="status" className={`live-status ${busy ? "loading" : ""}`}>
          {busy || displayMessage || "请选择门店读取当前菜单。"}
        </p>
      </section>
      <div className="live-workspace">
        <section className="live-catalog" aria-label="门店具体菜单">
          <div className="live-section-heading">
            <h3>这家店，现在可以点</h3>
            <button
              className="text-button"
              disabled={!storeCode || !!busy}
              onClick={() => chooseStore(storeCode)}
            >
              <RefreshCw size={14} /> 刷新菜单
            </button>
          </div>
          <p className="setting-hint">
            当前为 <strong>{active.name}</strong>{" "}
            选餐。图片与分组来自官方菜单；点开套餐可查看具体搭配。
          </p>
          {snapshot && (
            <>
              <div className="catalog-tools">
                <label>
                  <Search size={16} />
                  <input
                    aria-label="搜索具体商品"
                    placeholder="搜具体名字，例如：巨无霸、麦满分"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {search && (
                  <button
                    className="text-button"
                    aria-label="清空商品搜索"
                    onClick={() => setSearch("")}
                  >
                    <X size={15} /> 清空
                  </button>
                )}
              </div>
              <OfficialMenuCategories options={categoryOptions} value={selectedGroup} onChange={setOfficialGroup} label="门店菜单官方分类" />
              <p className="catalog-meta" role="status">
                {categoryLabel} · {search.trim() ? `“${search.trim()}” · ` : ""}
                {mealEntries.length} 个商品 · {timeText(snapshot.fetchedAt)}{" "}
                更新 · 展示价仅供参考
              </p>
              <div className="coupon-shelf">
                <h4>
                  <Ticket size={16} /> 本店可用券{" "}
                  <span>{snapshot.coupons.length}</span>
                </h4>
                {snapshot.coupons.length ? (
                  snapshot.coupons.map((c) => (
                    <div key={c.ref} className="live-coupon">
                      <strong>{c.title}</strong>
                      <p>{c.tradeDateTime || "使用时段以官方核价为准"}</p>
                      {c.products.map((p) => (
                        <button
                          key={p.productCode}
                          className="outline-button"
                          disabled={
                            !!busy ||
                            cart.length >= 12 ||
                            cart.some((l) => l.couponRef === c.ref)
                          }
                          onClick={() => viewProduct(p.productCode, c.ref)}
                        >
                          {cart.some((l) => l.couponRef === c.ref)
                            ? "已选入餐单"
                            : `查看并用券 · ${p.productName}`}
                        </button>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="setting-hint">
                    当前账户在此门店/时段没有返回可用券。
                  </p>
                )}
              </div>
              {!mealEntries.length && (
                <div className="live-empty">
                  <p>
                    {search.trim()
                      ? `“${categoryLabel}”中未找到“${search.trim()}”。`
                      : `当前门店和时段没有返回“${categoryLabel}”商品。`}
                  </p>
                  <p>可以换个关键词或分类；供餐时段变化后可刷新菜单。</p>
                  {selectedGroup && (
                    <button
                      className="outline-button"
                      onClick={() => setOfficialGroup("")}
                    >
                      在全部餐品中查看
                    </button>
                  )}
                </div>
              )}
              <div className="menu-grid">
                {mealEntries.slice(0, visibleCount).map(([code, item]) => (
                  <article className="menu-card" key={code}>
                    <button className="menu-image-button" aria-label={`查看图片与搭配：${item.name}`} disabled={!!busy || cart.length >= 12 || item.canWithOrder === true} onClick={() => viewProduct(code)}>
                      <ProductImage image={item.image} name={item.name} />
                    </button>
                    <div className="menu-card-top">
                      <span>
                        {item.canWithOrder
                          ? "需随单购卡"
                          : item.discountType || "门店菜单"}
                      </span>
                    </div>
                    <h4>{item.name}</h4>
                    <div className="menu-card-bottom">
                      <div>
                        <strong>
                          {item.currentPrice &&
                          /^\d+(\.\d{1,2})?$/.test(item.currentPrice)
                            ? `¥${item.currentPrice}`
                            : "待核价"}
                        </strong>
                        <small>
                          {item.canWithOrder ? "购卡条件未启用" : "菜单展示价"}
                        </small>
                      </div>
                      <button
                        className="outline-button"
                        aria-label={`查看 ${item.name}`}
                        disabled={
                          !!busy ||
                          cart.length >= 12 ||
                          item.canWithOrder === true
                        }
                        onClick={() => viewProduct(code)}
                      >
                        <Plus size={14} /> 查看
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {visibleCount < mealEntries.length && (
                <button
                  className="outline-button load-more"
                  onClick={() => setVisibleCount((n) => n + 18)}
                >
                  再看 18 个商品
                </button>
              )}
              <p className="setting-hint">
                图片仅供展示，套餐内容以详情中的默认搭配为准。菜单随门店、时段和账号变化，不保证包含官方 App 的全部活动。
              </p>
              <p className="setting-hint">
                “麦金卡优惠”是接口返回的商品标记，实际可享金额以整单核价为准。需要随单买卡的条目暂不可加入。
              </p>
              <details className="third-party-coupons"><summary>美团 / 抖音团购券怎么用？</summary><p>这里仅接入麦当劳账户内、当前门店可用的券。暂未接入美团或抖音核销，也不会把第三方券码当作麦当劳账户券。</p><p>请在原购买平台查看券的使用说明、适用门店和官方兑换入口，按券面规则兑换或到店出示。兑换到麦当劳账户后，刷新本页可用券；能否用于本单仍以门店返回和官方核价为准。</p></details>
            </>
          )}
          {!snapshot && (
            <div className="live-empty">
              <Coffee size={28} />
              <p>
                {busy
                  ? "正在读取实时菜单…"
                  : "菜单尚未加载成功，请查找门店或重试。"}
              </p>
            </div>
          )}
        </section>
        <aside className="live-cart" aria-label="真实餐单">
          <h3>
            <ShoppingBag size={19} /> 你们的具体餐单{" "}
            <span>{cart.length}/12</span>
          </h3>
          <p className="setting-hint">
            {sharedImport ? `本次结算：${sharedImport.members.map(m => m.name).join("、")}。只包含这些成员的已保存餐品；修改请返回上方共享餐桌。` : "尚未创建订单。切换上方成员，为每个人选餐。"}
          </p>
          {sharedImport ? <p className="setting-hint">{sharedImport.members.map(m => `${m.name}预算 ${formatMoney(m.budgetCents)}`).join(" · ")}</p> : room.payment.mode === "split" ? (
            <BudgetControl
              value={active.preferences.budgetCents}
              onChange={onBudget}
            />
          ) : (
            <p className="treat-note">
              本桌由{" "}
              {
                room.members.find(
                  (m) =>
                    room.payment.mode === "treat" &&
                    m.id === room.payment.payerId,
                )?.name
              }{" "}
              请客，整桌预算 {formatMoney(room.payment.totalBudgetCents)}。
            </p>
          )}
          {!cart.length && (
            <div className="live-empty">
              从左侧选一份具体餐品
              <br />
              餐品会记在 {active.name} 名下
            </div>
          )}
          {room.members
            .filter((m) => cart.some((l) => l.memberId === m.id))
            .map((m) => (
              <div className="member-cart" key={m.id}>
                <h4>
                  <span className={`mini-avatar ${m.color}`}>
                    {m.name.slice(-1)}
                  </span>
                  {m.name}
                </h4>
                {cart
                  .filter((l) => l.memberId === m.id)
                  .map((l) => (
                    <div className="cart-line" key={l.id}>
                      <div>
                        <strong>{l.name} ×1</strong>
                        {l.couponRef && (
                          <span className="coupon-chip">用券</span>
                        )}
                        {l.parts.length > 0 && (
                          <small>{l.parts.join(" · ")}</small>
                        )}
                      </div>
                      <button
                        aria-label={`移除 ${m.name}的${l.name}`}
                        disabled={!!busy || !!sharedImport}
                        onClick={() => {
                          setCart(cart.filter((row) => row.id !== l.id));
                          setQuoted(null);
                          setCopyText("");
                          setMessage("餐单已更新，请重新核价。");
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          <button
            className="primary-button quote-button"
            disabled={!!busy || !cart.length || !snapshot || sharedChanged}
            onClick={quote}
          >
            {busy ? "请稍候…" : "为这份餐单官方核价"}
          </button>
          {cart.length > 0 && displayMessage && !(quoted && !fresh) && (
            <p className="setting-hint" role="status">
              {displayMessage}
            </p>
          )}
          {quoted && !fresh && (
            <p className="error-notice">
              餐单、预算已变化，或报价超过本地 5 分钟复核期限，请重新核价。
            </p>
          )}
          {fresh && accounting && (
            <section className="official-quote">
              <span className="live-tag">
                <Check size={13} /> 官方已核价 · {timeText(fresh.quotedAt)}
              </span>
              <div className="official-total">
                {sharedImport ? "本次应付" : "整桌应付"}<strong>{formatMoney(fresh.quote.price)}</strong>
              </div>
              {accounting.allocations.map((a) => (
                <div className="quote-member" key={a.memberId}>
                  <span>
                    {room.members.find((m) => m.id === a.memberId)?.name}
                  </span>
                  <strong>{formatMoney(a.payableCents)}</strong>
                </div>
              ))}
              <p className="setting-hint">
                按商品小计比例分摊整单金额；同编码商品均分。这是本桌分账规则。报价需在下单前重核。
              </p>
              {accounting.conflicts.map((text) => (
                <p key={text} role="alert" className="error-notice">
                  {text}
                </p>
              ))}
              <button
                className="outline-button"
                disabled={!!accounting.conflicts.length}
                onClick={copy}
              >
                复制已核价清单
              </button>
            </section>
          )}
          {accountingError && (
            <p role="alert" className="error-notice">
              {accountingError}
            </p>
          )}
          <CheckoutPanel cart={cart} fresh={fresh} enabled={!!fresh && !!accounting && !accounting.conflicts.length && !busy && !sharedChanged} storeName={store?.storeName ?? ""} storeAddress={store?.address ?? ""} accountRevision={accountRevision} cartKey={currentKey} shared={sharedImport ? sharedCheckoutRef(sharedImport) : undefined} />
          {copyText && fresh && accounting && !accounting.conflicts.length && (
            <textarea
              aria-label="已核价清单文本"
              className="live-copy"
              readOnly
              rows={8}
              value={copyText}
            />
          )}
        </aside>
      </div>
      {pending && (
        <div className="modal-backdrop">
          <section
            className="meal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meal-detail-title"
          >
            <button
              className="dialog-close"
              aria-label="关闭餐品详情"
              onClick={() => setPending(null)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">
              给 {room.members.find((m) => m.id === pending.memberId)?.name}{" "}
              的这一份
            </span>
            <h3 id="meal-detail-title">{pending.detail.name}</h3>
            <ProductImage image={pending.detail.image ?? snapshot?.menu.meals[pending.detail.code]?.image} name={pending.detail.name} variant="detail" />
            <p>
              按门店当前默认搭配加入，具体内容如下。金额以整单官方核价为准。
            </p>
            {pending.detail.rounds?.length ? (
              <ul>
                {pending.detail.rounds.flatMap((r) =>
                  r.choices
                    .filter((c) => (c.quantity ?? 0) > 0)
                    .map((c) => (
                      <li key={`${r.id}-${c.code}`}>
                        <span>{c.name}</span>
                        <strong>×{c.quantity}</strong>
                      </li>
                    )),
                )}
              </ul>
            ) : (
              <div className="single-meal-detail">{pending.detail.name} ×1</div>
            )}
            {pending.couponRef && (
              <p className="coupon-chip">
                将使用本店可用券，核价时再次验证资格。
              </p>
            )}
            <div className="meal-dialog-actions">
              <button
                className="outline-button"
                onClick={() => setPending(null)}
              >
                再看看
              </button>
              <button
                className="primary-button"
                disabled={cart.length >= 12 || !!sharedImport}
                onClick={addProduct}
              >
                <Plus size={16} /> {sharedImport ? "请在共享餐桌修改后重新汇总" : "加入这份餐单"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
