"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Database, ExternalLink, Link2, ShieldCheck, UserRound, X } from "lucide-react";
import { Dialog as AccountDialog } from "radix-ui";
import { localApi, type LocalAccountStatus } from "../client/local-api";
import { useRemoteWorkspace } from "../client/workspace-mode";

export function LocalAccountPanel({ onAccount }: { onAccount: (revision: number) => void }) {
  const remote = useRemoteWorkspace();
  const [storageConsent, setStorageConsent] = useState(false);
  const [status, setStatus] = useState<LocalAccountStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const latestRevision = useRef(-1);
  const accept = useCallback((next: LocalAccountStatus) => {
    if (next.revision < latestRevision.current) return;
    latestRevision.current = next.revision;
    setStatus(next); onAccount(next.revision);
  }, [onAccount]);
  const refresh = useCallback(async () => {
    try { accept(await localApi<LocalAccountStatus>({ action: "status" })); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [accept]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const focus = () => void refresh();
    globalThis.addEventListener("focus", focus);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("maimai-account") : null;
    if (channel) channel.onmessage = focus;
    return () => { clearInterval(timer); globalThis.removeEventListener("focus", focus); channel?.close(); };
  }, [refresh]);
  async function act(action: "connect" | "verify" | "disconnect") {
    if (!status || busy) return;
    if (action === "connect" && remote && !storageConsent) return;
    setBusy(true); setError(""); setNotice("");
    const enteredToken = token.trim();
    setToken("");
    try {
      accept(await localApi<LocalAccountStatus>({ action, revision: status.revision, ...(action === "connect" ? { token: enteredToken } : {}) }));
      setConfirmDisconnect(false);
      setNotice(action === "disconnect" ? "已断开本应用连接；官方平台的 Token 不会被撤销。" : `已通过官方只读查询验证，授权已加密保存到${remote ? "发起人电脑上的独立工作区" : "本机"}。真实餐单已重置。`);
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("maimai-account"); channel.postMessage("changed"); channel.close(); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const label = !status ? "正在连接工作区服务" : status.source === "none" ? "未连接麦当劳账号" : status.verifiedAt ? "个人授权已验证" : "检测到本机授权 · 待验证";
  const connected = !!status && status.source !== "none";
  function changeOpen(next: boolean) {
    setOpen(next);
    setToken("");
    setStorageConsent(false);
    setConfirmDisconnect(false);
  }
  return (
    <AccountDialog.Root open={open} onOpenChange={changeOpen}>
      <AccountDialog.Trigger asChild>
        <button className="account-tag" aria-label="打开麦当劳账号设置" title={error ? "账号服务暂不可用，点击查看" : label}>
          <span className="account-tag-avatar"><UserRound size={15} /></span>
          <span>{connected ? "我的账号" : "账号登录"}</span>
          <span className={`account-status-dot ${error ? "has-error" : connected && status.verifiedAt ? "is-connected" : ""}`} aria-hidden="true" />
        </button>
      </AccountDialog.Trigger>
      <AccountDialog.Portal>
        <AccountDialog.Overlay className="account-modal-overlay" />
        <AccountDialog.Content className="account-modal">
          <div className="account-modal-heading">
            <span className="account-modal-icon"><UserRound size={21} /></span>
            <div>
              <AccountDialog.Title>我的麦当劳账号</AccountDialog.Title>
              <AccountDialog.Description>连接个人授权，用自己的优惠一起选餐。</AccountDialog.Description>
            </div>
            <AccountDialog.Close className="account-modal-close" aria-label="关闭账号窗口"><X size={19} /></AccountDialog.Close>
          </div>
          <div className="account-modal-body">
            <div className="account-connection-state"><ShieldCheck size={16} /><span>{label}</span></div>
            <div className="account-official-login">
              <p>先在官方平台登录，获取个人 MCP Token。</p>
              <a className="outline-button" href="https://open.mcd.cn/mcp" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> 去官方平台登录</a>
            </div>
            <form className="account-connect-form" onSubmit={e => { e.preventDefault(); void act("connect"); }}>
              <label htmlFor="mcd-personal-token">个人 MCP Token</label>
              <input id="mcd-personal-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck={false} minLength={10} maxLength={8192} required placeholder={connected ? "粘贴新 Token，可更换账号" : "粘贴官方平台提供的 Token"} disabled={busy} />
              {remote && <label className="guest-token-consent"><input type="checkbox" checked={storageConsent} onChange={e => setStorageConsent(e.target.checked)} required />我同意将授权加密保存在发起人的电脑上，并信任其管理该电脑。也可以不连接，直接体验演示。</label>}
              <button className="primary-button" type="submit" disabled={busy || !status || !token.trim() || (remote && !storageConsent)}><Link2 size={15} /> {busy ? "正在处理…" : connected ? "验证并更换账号" : "验证并连接账号"}</button>
            </form>
            {connected && <button className="outline-button account-reverify" disabled={busy} onClick={() => void act("verify")}><ShieldCheck size={15} /> {status.source === "environment" ? "验证并保存已有授权" : "重新验证当前授权"}</button>}
            <p className="account-privacy-note">手机号和验证码只在官方平台填写。{remote ? "授权保存在发起人电脑上的独立工作区，其他访客无法读取；电脑管理者仍拥有磁盘访问权限。" : "授权加密保存在本机。"}不会自动下单或支付。</p>
            {error && <p className="error-notice" role="alert">{error}</p>}
            {notice && <p className="account-result" role="status">{notice}</p>}
            <details className="account-data-details">
              <summary><Database size={15} /><span>{remote ? "我的工作区与连接详情" : "本机数据与连接详情"}</span><ChevronDown size={14} /></summary>
              <div>
                <strong>{status ? `SQLite ${remote ? "独立工作区" : "本机数据库"}已连接` : "数据库连接待确认"}</strong>
                <p>保存找搭子发布和加密授权，重启后可恢复。{status ? `当前 ${status.partyCount} 条饭局记录。` : ""}</p>
                {status?.verifiedAt && <p>最近成功验证：{new Date(status.verifiedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。不代表永久有效或已核实会员有效期。</p>}
                <p>{remote ? "仅当前浏览器的工作区使用此授权。访问保留 7 天；退出、清除 Cookie 或换用新链接后会创建新工作区。" : "本机页面共用这一份个人授权。"}当前通过 Token 接入，尚未提供嵌入式扫码登录。</p>
              </div>
            </details>
            <div className="account-modal-actions">
              <button className="text-button" disabled={busy} onClick={() => void refresh()}>刷新状态</button>
              {connected && <button className="text-button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>断开本应用连接</button>}
            </div>
            {confirmDisconnect && <div className="account-disconnect-confirm"><p>断开后清空真实餐单，饭局记录保留。重新连接需再次验证 Token。</p><button className="outline-button" disabled={busy} onClick={() => void act("disconnect")}>确认断开</button><button className="text-button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>保留连接</button></div>}
          </div>
        </AccountDialog.Content>
      </AccountDialog.Portal>
    </AccountDialog.Root>
  );
}
