"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { UsersRound, Link2, RefreshCw, Check, Plus, Minus, Search, XCircle, RotateCcw, UserMinus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { sharedTableApi, SharedTableError } from "../client/shared-table-api";
import { officialCategoryOptions, matchesMenuSearch } from "../domain/menu-categories";
import { OfficialMenuCategories } from "./official-menu-categories";
import type { SharedCatalogData, SharedTable, SharedPick, SharedImport } from "../domain/shared-table";
import { formatMoney } from "../domain/money";
import { ProductImage } from "./product-image";
import { tableInvitationLink } from "../domain/table-invitation";
import { TableInvitationQr } from "./table-invitation-qr";

const rememberedKey = "maimai-shared-table-v1";
export function SharedTablePanel({ catalog, onSnapshot, onImport, importing, importedRevision }: {
  catalog: SharedCatalogData | null; onSnapshot: (table: SharedTable | null) => void;
  onImport: (draft: SharedImport) => void; importing: boolean; importedRevision: number | null;
}) {
  const [table, setTable] = useState<SharedTable | null>(null);
  const [target, setTarget] = useState<{ id: string; invite: string } | null>(null);
  const [name, setName] = useState(""); const [budget, setBudget] = useState("50");
  const [capacity, setCapacity] = useState("4"); const [title, setTitle] = useState("今天一起麦麦合拍");
  const [picks, setPicks] = useState<SharedPick[]>([]); const [baseRevision, setBaseRevision] = useState(0);
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false);
  const [search, setSearch] = useState("");
  const [officialGroup, setOfficialGroup] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [syncError, setSyncError] = useState("");
  const [shareLink, setShareLink] = useState(""); const savedInvite = useRef(""); const activeId = useRef("");
  const [linkNotice, setLinkNotice] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false); const [reopenCapacity, setReopenCapacity] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const invitationInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setLinkNotice(""); }, [shareLink]);
  const acceptedRevision = useRef(-1);
  function markDirty() { dirtyRef.current = true; setDirty(true); setNotice(""); }
  const accept = useCallback((next: SharedTable, resetDraft = false) => {
    if (activeId.current !== next.id) return;
    if (next.revision < acceptedRevision.current) return;
    acceptedRevision.current = next.revision;
    setTable(next);
    onSnapshot(next); setSyncError("");
    if (resetDraft || !dirtyRef.current) {
      const me = next.members.find(m => m.id === next.myMemberId)!;
      setName(me.name); setBudget(String(me.budgetCents / 100)); setPicks(me.picks); setBaseRevision(me.revision);
      dirtyRef.current = false; setDirty(false);
    }
    if (next.invite) savedInvite.current = next.invite;
    setShareLink(tableInvitationLink(next.publicOrigin, next.id, savedInvite.current, next.closed));
    try { localStorage.setItem(rememberedKey, JSON.stringify({ id: next.id, invite: savedInvite.current })); } catch { /* Cookie/server identity still works. */ }
  }, [onSnapshot]);
  function leaveView() {
    activeId.current = ""; acceptedRevision.current = -1; savedInvite.current = "";
    setTable(null); setTarget(null); onSnapshot(null); setPicks([]); setShareLink("");
    setSearch(""); setOfficialGroup("");
    setAccessLost(false); setExcludedIds([]); setReopenOpen(false); setRemoveId(null);
    dirtyRef.current = false; setDirty(false); setError(""); setNotice("");
    try { localStorage.removeItem(rememberedKey); } catch { /* Browser storage is optional. */ }
    history.replaceState(null, "", location.pathname);
  }
  useEffect(() => {
    let disposed = false;
    const fragment = new URLSearchParams(location.hash.slice(1));
    let remembered: { id?: string; invite?: string } = {};
    try { remembered = JSON.parse(localStorage.getItem(rememberedKey) ?? "{}"); } catch { /* Ignore old browser storage. */ }
    const id = fragment.get("table") ?? remembered.id;
    const invite = fragment.get("invite") ?? remembered.invite ?? "";
    if (!id || !/^[a-f0-9]{24}$/.test(id)) return;
    activeId.current = id; savedInvite.current = invite;
    setTarget({ id, invite });
    void sharedTableApi({ action: "read", id }).then(next => { if (!disposed) accept(next, true); }).catch(e => {
      if (!disposed && e instanceof SharedTableError && e.status === 403 && e.message.includes("移出")) { setAccessLost(true); setError(e.message); }
    });
    return () => { disposed = true; };
  }, [accept]);
  useEffect(() => {
    if (!table || accessLost) return;
    let disposed = false; let pending = false;
    const poll = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try { const next = await sharedTableApi({ action: "read", id: table.id }); if (!disposed) accept(next); }
      catch (e) { if (!disposed) {
        if (e instanceof SharedTableError && e.status === 403) { setAccessLost(true); onSnapshot(null); setError(e.message); }
        else setSyncError("暂时未同步，正在保留上次结果。请确认网络和发起人的电脑在线。");
      } }
      finally { pending = false; }
    };
    const timer = setInterval(() => void poll(), 3000);
    window.addEventListener("focus", poll);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [table?.id, accept, accessLost, onSnapshot]);
  async function act(kind: "create" | "join" | "save" | "ready" | "reload" | "close" | "reopen") {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      const value = Number(budget);
      if (["create", "join", "save", "ready"].includes(kind) && (!/^\d+(\.\d{1,2})?$/.test(budget) || value < 1 || value > 1000)) throw new Error("预算请输入 1—1000 元，最多两位小数。");
      let input: Record<string, unknown>;
      if (kind === "create") { if (!catalog) throw new Error("请先在下方真实点餐中读取门店菜单。"); input = { action: "create", title, capacity: Number(capacity), name, budgetCents: Math.round(value * 100), catalog }; }
      else if (kind === "join") { if (!target) return; input = { action: "join", ...target, name, budgetCents: Math.round(value * 100) }; }
      else { if (!table) return;
        if (kind === "reopen" && (!reopenCapacity || Number(reopenCapacity) < table.members.length)) throw new Error("请先选择本次名额，人数不足时先移除多余成员。");
        input = kind === "reload" ? { action: "read", id: table.id } : (kind === "close" || kind === "reopen") ? { action: "close", id: table.id, revision: table.revision, closed: kind === "close", ...(kind === "reopen" ? { capacity: Number(reopenCapacity) } : {}) } : { action: "update", id: table.id, revision: baseRevision, name, budgetCents: Math.round(value * 100), picks, ready: kind === "ready" };
      }
      const next = await sharedTableApi(input);
      activeId.current = next.id; setTarget({ id: next.id, invite: next.invite ?? savedInvite.current }); accept(next, kind !== "close" && kind !== "reopen");
      if (kind === "reopen") setReopenOpen(false);
      setNotice(kind === "ready" ? "已保存到共享餐桌，大家能看到你选好了。" : kind === "save" ? "餐品和预算已同步到共享餐桌。" : kind === "create" ? "共享餐桌已建立。远程分享在线时，会自动生成本桌的邀请链接和二维码。" : kind === "join" ? "已加入同一张餐桌，现在只需选择你自己的那一份。" : kind === "close" ? "本次合拍已取消，已保存的成员、预算和餐品保留。" : kind === "reopen" ? "合拍已重新开启，有效期从现在起 24 小时；继续点餐前请复核门店菜单。" : "已载入最新状态。");
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法同步。"); }
    finally { setBusy(false); }
  }
  async function removeMember() {
    if (!table || !removeId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      accept(await sharedTableApi({ action: "remove", id: table.id, revision: table.revision, memberId: removeId }));
      setRemoveId(null); setNotice("成员已移出，名额已释放。其餐品不会再计入后续汇总，已提交的订单不受影响。");
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法移除成员。"); }
    finally { setBusy(false); }
  }
  function changePick(code: string, delta: number) {
    if (busy || table?.closed) return;
    markDirty(); setPicks(rows => {
      const quantity = (rows.find(p => p.code === code)?.quantity ?? 0) + delta;
      if (quantity < 1) return rows.filter(p => p.code !== code);
      if (quantity > 6) return rows;
      return rows.some(p => p.code === code) ? rows.map(p => p.code === code ? { ...p, quantity } : p) : [...rows, { code, quantity }];
    });
  }
  async function copyLink() {
    if (!shareLink || !table || table.closed || Date.now() >= table.expiresAt) return;
    try { await navigator.clipboard.writeText(shareLink); setLinkNotice("已复制！发给朋友，打开后填写昵称和预算即可加入这桌。"); }
    catch { invitationInput.current?.focus(); invitationInput.current?.select(); setLinkNotice("已选中完整链接，请长按复制，或按 Ctrl+C / ⌘C 复制。"); }
  }
  async function refreshInvitation() {
    if (!table || busy) return;
    setBusy(true); setLinkNotice("");
    try { accept(await sharedTableApi({ action: "read", id: table.id })); }
    catch (e) { setLinkNotice(e instanceof Error ? e.message : "暂时无法刷新邀请链接。"); }
    finally { setBusy(false); }
  }
  async function syncMenuPrices() {
    if (!table || busy || !catalog || catalog.storeCode !== table.catalog.storeCode) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const latest = new Map(catalog.items.map(item => [item.code, item.menuPriceCents]));
      const next = await sharedTableApi({ action: "prices", id: table.id, revision: table.revision, storeCode: catalog.storeCode,
        prices: table.catalog.items.map(item => ({ code: item.code, menuPriceCents: latest.get(item.code) ?? null })) });
      accept(next); // Updating display prices must preserve unsaved meal choices.
      setNotice("门店展示价已同步给同桌朋友，已选餐品和预算保持不变。最终金额以官方核价为准。");
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法同步价格，请稍后重试。"); }
    finally { setBusy(false); }
  }
  const me = table?.members.find(m => m.id === table.myMemberId);
  const readyMembers = table?.members.filter(m => m.ready && m.picks.length && !m.submitted) ?? [];
  const checkoutMembers = readyMembers.filter(m => !excludedIds.includes(m.id));
  const removingMember = table?.members.find(m => m.id === removeId);
  const invitationExpired = !!table && Date.now() >= table.expiresAt;
  const inactive = !!table && (table.closed || invitationExpired);
  const canShare = !!shareLink && !inactive;
  const categoryOptions = officialCategoryOptions(table?.catalog.items ?? []);
  const selectedGroup = categoryOptions.some(option => option.value === officialGroup) ? officialGroup : "";
  const visibleItems = table?.catalog.items.filter(i => (!selectedGroup || i.groups?.includes(selectedGroup)) && matchesMenuSearch(i.name, search)) ?? [];
  if (accessLost) return <section className="shared-table-panel"><h2>你已离开这张餐桌</h2><p role="alert" className="error-notice">{error || "发起人已将你移出，不能继续查看或修改这桌的选餐。"}</p><button className="outline-button" onClick={leaveView}>返回，另开一桌</button></section>;
  return <section className="shared-table-panel" aria-labelledby="shared-table-heading">
    <div className="shared-table-heading"><div><span className="eyebrow">ONE TABLE · LIVE TOGETHER</span><h2 id="shared-table-heading"><UsersRound size={23} />{table?.title ?? (target ? "加入朋友的共享餐桌" : "让朋友在自己的手机上选餐")}</h2></div><span className={`shared-sync-badge${inactive ? " is-inactive" : ""}`}>{table ? `${table.closed ? "已取消合拍" : invitationExpired ? "合拍已过期" : "实时共享"} · ${table.members.length}/${table.capacity} 人` : "跨设备同步"}</span></div>
    {!table ? <>
      <p className="subtle">{target ? "填写昵称和预算，加入这张餐桌。不需要麦当劳 Token，也不会使用别人的账号。" : "先读取真实门店菜单，再开共享餐桌。朋友各自选餐和设置预算，发起人最后统一核价。"}</p>
      <div className="shared-setup"><label>我的昵称<input maxLength={12} value={name} onChange={e => setName(e.target.value)} placeholder="怎么称呼你" /></label><label>我的预算（元）<input type="number" min="1" max="1000" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} /></label>{!target && <><label>餐桌名称<input maxLength={40} value={title} onChange={e => setTitle(e.target.value)} /></label><label>名额（含我）<select value={capacity} onChange={e => setCapacity(e.target.value)}>{[2,3,4,5,6].map(n => <option key={n} value={n}>{n} 人</option>)}</select></label></>}</div>
      {!target && <p className="shared-small">{catalog ? `菜单已就绪：${catalog.storeName} · ${catalog.items.length} 款餐品。共享商品名称、菜单展示价、官方图片与分组，不共享账号、卡券或核价。` : "菜单尚未就绪：请在下方切到「真实点餐」，连接个人授权并读取门店。"}</p>}
      <button className="primary-button" disabled={busy || !name.trim() || (!target && !catalog)} onClick={() => void act(target ? "join" : "create")}>{target ? "加入这张餐桌" : "创建共享餐桌"}<Link2 size={16} /></button>
      {target && <button className="text-button" disabled={busy} onClick={leaveView}>暂不加入，自己开一桌</button>}
    </> : <>
      <div className={`shared-lifecycle${inactive ? " is-inactive" : ""}`} aria-label="合拍管理">
        <div><strong>{table.closed ? "本次合拍已取消" : invitationExpired ? "本次合拍已过期" : "管理本次合拍"}</strong>
          <p>{inactive ? "成员、预算和已保存的餐品仍保留，重新开启后可以继续选择。" : "取消后暂停邀请和选餐，已保存的记录保留，可以随时重新开启。"}</p>
          <p className="shared-small">{table.isHost ? "重新开启后有效期为 24 小时。此操作不会取消已创建的官方订单。" : inactive ? "请等待发起人重新开启合拍。" : "由发起人管理合拍的取消与重新开启。"}</p>
        </div>
        {table.isHost && <button className={inactive ? "primary-button" : "outline-button shared-cancel-button"} disabled={busy || importing} onClick={() => { if (inactive) { setReopenCapacity(""); setError(""); setReopenOpen(true); } else void act("close"); }}>
          {inactive ? <RotateCcw size={17} /> : <XCircle size={17} />}{busy ? "正在处理…" : inactive ? "重新开启合拍" : "取消本次合拍"}
        </button>}
      </div>
      {error && <p className="error-notice" role="alert">{error}</p>}{notice && <p className="table-notice" role="status">{notice}</p>}
      <p className="shared-small">{table.catalog.storeName} · 到店自取 · 菜单由发起人分享，商品现价、套餐搭配与优惠由发起人最终复核。餐桌有效期为创建或重新开启后的 24 小时。</p>
      {table.isHost && <section className="shared-invitation-card" aria-label="邀请朋友加入餐桌">
        <div className="shared-invitation-heading"><h3><Link2 size={18} />邀请朋友加入这桌</h3><span className={canShare ? "shared-ready" : "shared-small"}>{invitationExpired ? "邀请已过期" : table.closed ? "邀请已暂停" : canShare ? "远程链接已生成" : "等待远程分享"}</span></div>
        {canShare ? <div className="shared-invitation-body">
          <div className="shared-invitation-details">
            <p>复制链接或让朋友扫描二维码。对方用自己的手机、电脑打开，填写昵称和预算，就能加入同一张餐桌。</p>
            <div className="shared-invite"><label>这张餐桌的专属邀请链接<input ref={invitationInput} readOnly aria-label="共享餐桌邀请链接" value={shareLink} onFocus={e => e.target.select()} /></label><button className="primary-button" onClick={() => void copyLink()}><Link2 size={16} />复制邀请链接</button></div>
            <p className="shared-small">支持不同设备、不同网络，不需要连接同一个 Wi-Fi。保存后的餐品和预算约每 3 秒同步到这桌。</p>
            <p className="shared-small">无需另发访问邀请码或麦当劳 Token。邀请仅供受邀朋友使用，餐桌关闭或超过 24 小时后不能再加入。</p>
          </div>
          <TableInvitationQr key={shareLink} link={shareLink} />
        </div> : <div className="shared-invitation-offline"><p>{invitationExpired ? "这张餐桌已过期。点击上方「重新开启合拍」后可继续邀请。" : table.closed ? "这张餐桌已取消。点击上方「重新开启合拍」后可继续邀请。" : !savedInvite.current ? "当前浏览器没有保存本桌的完整邀请信息，请使用创建餐桌时的浏览器，或重新开桌。" : "远程分享尚未连接，暂时不能生成外地朋友可用的链接和二维码。"}</p>{!invitationExpired && !table.closed && savedInvite.current && <><p>在这台电脑的项目目录双击「远程分享启动.cmd」，保持窗口运行。只开本机网页还不能远程访问；通道连接成功后，这里会自动出现邀请链接和二维码。</p><button className="outline-button" disabled={busy} onClick={() => void refreshInvitation()}><RefreshCw size={14} />刷新邀请链接</button></>}</div>}
        {linkNotice && <p className="table-notice" role="status">{linkNotice}</p>}
        <p className="shared-small">发起人的电脑需保持开机、联网且不休眠，远程分享程序需持续运行。重连后公网地址可能变化，请重新复制链接或保存最新二维码。</p>
      </section>}
      {syncError && <p role="status" className="error-notice">{syncError}</p>}
      <div className="shared-members">{table.members.map(m => <article key={m.id} className={m.id === table.myMemberId ? "is-me" : ""}><strong>{m.name}{m.id === table.myMemberId ? "（我）" : ""}<small>{m.host ? "发起人" : "饭搭子"}</small></strong><span>预算 {formatMoney(m.budgetCents)}</span><ul>{m.picks.length ? m.picks.map(p => <li key={p.code}>{table.catalog.items.find(i => i.code === p.code)?.name ?? "待复核餐品"} ×{p.quantity}</li>) : <li className="subtle">还在挑选</li>}</ul><span className={m.ready ? "shared-ready" : "shared-small"}>{m.submitted ? "已提交下单 · 请查看订单结果" : m.ready ? "✓ 已选好" : "选择中"}</span>{table.isHost && !m.host && <button className="text-button shared-remove" aria-label={`移除成员 ${m.name}`} disabled={busy || importing} onClick={() => { setRemoveId(m.id); setError(""); }}><UserMinus size={14} />移出队伍</button>}</article>)}</div>
      {table.isHost && !inactive && <section className="shared-batch-checkout" aria-label="选择本次结算成员">
        <h3>选好了，就可以先结算</h3><p className="shared-small">勾选本次要付款的成员，至少 1 人即可。不必等人齐，尚未选好的朋友可以继续挑选。</p>
        <div className="shared-checkout-members">{readyMembers.map(m => <label key={m.id}><input type="checkbox" checked={!excludedIds.includes(m.id)} disabled={busy || importing} onChange={e => setExcludedIds(ids => e.target.checked ? ids.filter(id => id !== m.id) : [...ids, m.id])} /><span>{m.name}<small>{m.picks.reduce((n, p) => n + p.quantity, 0)} 份 · 预算 {formatMoney(m.budgetCents)}</small></span></label>)}</div>
        {!readyMembers.length && <p className="shared-small">暂时没有待结算的成员。保存餐品并标记「我选好了」后，会出现在这里；已提交的餐品不会重复计入。</p>}
        <p className="shared-small">本次：{checkoutMembers.map(m => m.name).join("、") || "尚未选择"}。由发起人统一核价、确认下单，再打开官方支付页面。</p>
        {dirty && checkoutMembers.some(m => m.id === table.myMemberId) && <p className="shared-small">你有未保存的修改，请先保存并标记选好，或取消勾选自己。</p>}
        <button className="primary-button" disabled={!checkoutMembers.length || (dirty && checkoutMembers.some(m => m.id === table.myMemberId)) || busy || importing} onClick={() => onImport({ id: table.id, revision: table.revision, managementRevision: table.managementRevision ?? 0, catalog: table.catalog, members: checkoutMembers })}>{importing ? "正在核对餐品…" : `结算选中的 ${checkoutMembers.length} 人 · 去核价`}</button>
        {importedRevision !== null && <p className="shared-small">已载入下方真实餐单。请核对本次成员和餐品，再完成官方核价与下单确认。</p>}
      </section>}
      {me?.submitted && <p className="table-notice">你这一份已提交下单，本轮不会再次汇总。请由发起人在「订单与支付」中查询结果；需要另点一单可新开一桌。</p>}
      {!inactive && !me?.submitted && <div className="shared-editor"><div className="shared-editor-head"><h3>只编辑我的这一份</h3><span className="shared-small">{dirty ? "有未保存的修改" : `已同步 · 我的版本 ${me?.revision ?? 0}`}</span></div><div className="shared-setup"><label>我的昵称<input value={name} maxLength={12} disabled={busy || table.closed} onChange={e => { setName(e.target.value); markDirty(); }} /></label><label>我的预算（元）<input type="number" min="1" max="1000" step="0.01" disabled={busy || table.closed} value={budget} onChange={e => { setBudget(e.target.value); markDirty(); }} /></label></div>
        <div className="shared-price-note"><p>以下为发起人分享的门店菜单展示价，优惠、套餐选配后的最终金额以官方核价为准；未提供价格的餐品显示「待核价」。</p>{table.isHost && <button className="text-button" disabled={busy || table.closed || !catalog || catalog.storeCode !== table.catalog.storeCode} onClick={() => void syncMenuPrices()}><RefreshCw size={14} />同步菜单价格</button>}</div>
        {table.isHost && table.catalog.items.some(i => i.menuPriceCents === undefined) && (!catalog || catalog.storeCode !== table.catalog.storeCode) && <p className="shared-small">部分餐品尚无展示价。可在下方读取本桌门店的菜单后，点击「同步菜单价格」更新给朋友。</p>}
        <div className="shared-search"><Search size={16} /><input aria-label="搜索共享菜单" placeholder="搜索具体餐品，例如巨无霸" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <OfficialMenuCategories options={categoryOptions} value={selectedGroup} onChange={setOfficialGroup} label="共享菜单官方分类" />
        <p className="shared-small" role="status">{categoryOptions.find(option => option.value === selectedGroup)?.label} · {search.trim() ? `“${search.trim()}” · ` : ""}{visibleItems.length} 款餐品</p>
        <div className="shared-products">{visibleItems.map(i => (
          <article className="shared-product-card" key={i.code}>
            <ProductImage image={i.image} name={i.name} />
            <h4>{i.name}</h4>
            <div className="shared-product-bottom">
              <div className="shared-product-price">{i.menuPriceCents === undefined ? <span className="shared-price-pending">待核价</span> : <><strong>{formatMoney(i.menuPriceCents)}</strong><small>菜单展示价</small></>}</div>
              <div className="shared-product-quantity">
                <button aria-label={`减少${i.name}`} disabled={busy || table.closed || !picks.some(p => p.code === i.code)} onClick={() => changePick(i.code, -1)}><Minus size={18} /></button>
                <b>{picks.find(p => p.code === i.code)?.quantity ?? 0}</b>
                <button aria-label={`添加${i.name}`} disabled={busy || table.closed || (picks.find(p => p.code === i.code)?.quantity ?? 0) >= 6} onClick={() => changePick(i.code, 1)}><Plus size={18} /></button>
              </div>
            </div>
          </article>
        ))}</div>
        {!visibleItems.length && <div className="shared-menu-empty"><p className="subtle">当前分类没有符合条件的餐品，试试其他分类或修改搜索词。</p>{selectedGroup && <button className="outline-button" onClick={() => setOfficialGroup("")}>在全部餐品中搜索</button>}</div>}
        <p className="shared-small">本次选择：{picks.length ? picks.map(p => `${table.catalog.items.find(i => i.code === p.code)?.name} ×${p.quantity}`).join("、") : "还没有餐品"}。整桌最多 12 份；保存后大家即可看到。</p>
        <div className="shared-actions"><button className="outline-button" disabled={busy || table.closed || !dirty} onClick={() => void act("save")}>保存我的选择</button><button className="primary-button" disabled={busy || table.closed || !picks.length} onClick={() => void act("ready")}><Check size={16} />保存并标记「我选好了」</button><button className="text-button" disabled={busy} onClick={() => void act("reload")}><RefreshCw size={14} />载入最新选择{dirty ? "（放弃未保存修改）" : ""}</button></div>
      </div>}
      <button className="text-button" disabled={busy || importing} onClick={leaveView}>切换到另一张餐桌（本桌已保存的选择保留）</button>
    </>}
    {!table && <>{error && <p className="error-notice" role="alert">{error}</p>}{notice && <p className="table-notice" role="status">{notice}</p>}</>}
    <Dialog.Root open={reopenOpen} onOpenChange={next => { if (!busy) setReopenOpen(next); }}><Dialog.Portal><Dialog.Overlay className="checkout-overlay" /><Dialog.Content className="checkout-dialog">
      <Dialog.Title>这次合拍，几个人？</Dialog.Title><Dialog.Description>每次重新开启前选择本次总名额，包含发起人。现有成员和选餐会保留。</Dialog.Description>
      <Dialog.Close className="dialog-close" aria-label="关闭人数设置" disabled={busy}><X size={20} /></Dialog.Close>
      <label className="checkout-label">本次总名额（含我）<select value={reopenCapacity} onChange={e => setReopenCapacity(e.target.value)} disabled={busy}><option value="">请选择本次人数</option>{[2,3,4,5,6].map(n => <option key={n} value={n} disabled={n < (table?.members.length ?? 1)}>{n} 人{n < (table?.members.length ?? 1) ? "（需先移除多余成员）" : ""}</option>)}</select></label>
      <p className="shared-small">目前有 {table?.members.length} 位成员。想缩小到更少的人数，请先关闭此窗口，在成员卡片上移出多余的人。</p>
      {error && <p className="error-notice" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || !reopenCapacity || Number(reopenCapacity) < (table?.members.length ?? 1)} onClick={() => void act("reopen")}>{busy ? "正在开启…" : "按所选人数重新开启"}</button>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={!!removeId} onOpenChange={next => { if (!next && !busy) setRemoveId(null); }}><Dialog.Portal><Dialog.Overlay className="checkout-overlay" /><Dialog.Content className="checkout-dialog">
      <Dialog.Title>移出「{removingMember?.name}」？</Dialog.Title><Dialog.Description>将释放这位成员的名额，其选餐不再计入后续汇总。对方当前身份不能继续访问这桌，已创建的官方订单不会取消。</Dialog.Description>
      <Dialog.Close className="dialog-close" aria-label="关闭移除确认" disabled={busy}><X size={20} /></Dialog.Close>
      {error && <p className="error-notice" role="alert">{error}</p>}
      <div className="shared-actions"><button className="outline-button" disabled={busy} onClick={() => setRemoveId(null)}>保留成员</button><button className="primary-button" disabled={busy || !removingMember} onClick={() => void removeMember()}>{busy ? "正在移除…" : "确认移出队伍"}</button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
