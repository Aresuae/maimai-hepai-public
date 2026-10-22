import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, UsersRound, LockKeyhole, LogOut } from "lucide-react";
import Home from "../../app/page";
import DesignPage from "../../app/design/page";
import { RemoteWorkspace } from "../client/workspace-mode";
import { parseTableInvitation } from "../domain/table-invitation";
import "../../app/globals.css";
import "./share.css";

function ShareApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);
  const [tableInvite] = useState(() => parseTableInvitation(location.hash));
  const [hasTableLink] = useState(() => new URLSearchParams(location.hash.slice(1)).has("table"));
  useEffect(() => {
    let disposed = false;
    const check = async (openInvitation = false) => {
      try {
        const response = await fetch("/api/access", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error();
        let value = await response.json() as { authenticated?: boolean };
        if (disposed) return;
        if (!value.authenticated && openInvitation && tableInvite) {
          const admission = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "table-login", ...tableInvite }), signal: AbortSignal.timeout(20000) });
          const result = await admission.json() as { authenticated?: boolean; error?: string };
          if (disposed) return;
          if (!admission.ok) { setError(result.error ?? "餐桌邀请暂不可用，请重试。"); setAuthenticated(false); return; }
          value = result;
        }
        setAuthenticated(value.authenticated === true);
      } catch { if (!disposed) { setError("暂时连不上朋友的电脑，请确认分享服务仍在运行后重试。"); setAuthenticated(current => current ?? false); } }
    };
    const expired = () => { setAuthenticated(false); setError(tableInvite ? "访问已过期，请重新打开餐桌邀请。" : "访问已过期，请重新输入邀请码。"); };
    void check(true); const timer = setInterval(() => void check(), 60000);
    window.addEventListener("maimai-access-expired", expired);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("maimai-access-expired", expired); };
  }, [tableInvite]);
  async function action(kind: "login" | "logout" | "table-login", event?: FormEvent) {
    event?.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, ...(kind === "login" ? { code: code.trim() } : kind === "table-login" ? tableInvite : {}) }), signal: AbortSignal.timeout(20000) });
      const value = await response.json() as { authenticated: boolean; error?: string };
      if (!response.ok) throw new Error(value.error ?? "暂时无法操作，请重试。");
      setAuthenticated(value.authenticated); setCode(""); setConfirmExit(false);
    } catch (e) { setError(e instanceof Error ? e.message : "连接失败，请重试。"); }
    finally { setBusy(false); }
  }
  if (authenticated === null) return <main className="share-loading">正在打开朋友的餐桌…</main>;
  if (authenticated) return <RemoteWorkspace.Provider value={true}>
    <aside className="share-banner"><span><UsersRound size={16} />朋友内测 · 账号独立 <small>使用餐桌邀请链接，可同步餐品与预算</small></span><button onClick={() => setConfirmExit(v => !v)}><LogOut size={14} />退出访问</button></aside>
    {confirmExit && <div className="share-exit"><p>退出会断开本工作区的麦当劳授权，再次进入会创建新工作区。只想稍后回来，可直接关闭网页。</p><button disabled={busy} onClick={() => void action("logout")}>确认退出</button><button onClick={() => setConfirmExit(false)}>继续体验</button></div>}
    {error && <p className="share-alert" role="alert">{error}</p>}
    {location.pathname === "/design" ? <DesignPage /> : <Home />}
  </RemoteWorkspace.Provider>;
  return <main className="share-entry">
    <header className="share-brand"><span className="brand-symbol"><i /><i /></span><strong>麦麦合拍<small>MAIMAI TOGETHER</small></strong><span className="share-beta">朋友内测</span></header>
    <section className="share-welcome"><div className="share-illustration" aria-hidden="true"><span>一起</span><UsersRound size={52} strokeWidth={1.4} /><span>合拍</span></div><div className="eyebrow">好好吃饭，也好好相聚</div><h1>这顿，<br />和朋友一起合拍。</h1><p>带上朋友的邀请码，<br />从一句「随便」到一桌刚刚好的选择。</p></section>
    <section className="share-login"><div className="share-login-icon"><LockKeyhole size={24} /></div><h2>赴朋友的饭局</h2><p>{hasTableLink ? "餐桌邀请链接可直接进入，无需另填邀请码或麦当劳 Token。" : "输入发起人分享的邀请码，开始体验。"}</p>
      {hasTableLink ? <>{tableInvite ? <button className="primary-button" disabled={busy} onClick={() => void action("table-login")}>{busy ? "正在打开餐桌…" : "打开朋友的餐桌"}<ArrowRight size={17} /></button> : <p className="error-notice" role="alert">餐桌邀请链接不完整，请让朋友重新复制完整链接。</p>}</> : <form onSubmit={e => void action("login", e)}><label htmlFor="invite-code">邀请码</label><input id="invite-code" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} placeholder="粘贴朋友发来的邀请码" maxLength={128} required disabled={busy} /><button className="primary-button" type="submit" disabled={busy || !code.trim()}>{busy ? "正在赴约…" : "进入麦麦合拍"}<ArrowRight size={17} /></button></form>}
      {error && <p className="error-notice" role="alert">{error}</p>}
      <div className="share-explainer"><strong>自己的账号，一起的餐桌</strong><p>用餐桌邀请链接加入后，餐品和预算会同步给同桌朋友；不需要麦当劳 Token。个人授权与私人发布记录仍相互隔离。</p><p>数据保存在发起人的电脑上。当前投票与搭子申请仍为演示。发起人可以核价、确认下单，再打开官方支付页面。</p></div>
    </section><footer>让每一份偏好，都在这张餐桌上有位置。<span>发起人电脑需保持开机与联网</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ShareApp />);
