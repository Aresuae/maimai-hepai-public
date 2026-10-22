"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clipboard,
  Shuffle,
  Coffee,
  Heart,
  RotateCcw,
  Sparkles,
  Users,
  Utensils,
  X,
} from "lucide-react";
import { DEMO_MEMBERS, DEMO_MENU } from "../src/providers/demo";
import { buildDemoPlans } from "../src/domain/planner";
import {
  confirmPlan,
  createDemoRoom,
  proposePlans,
  revokeConfirmation,
  selectPlan,
  updatePreference,
  updatePayment,
  replaceRoster,
} from "../src/domain/room";
import { formatMoney } from "../src/domain/money";
import { chooseRandomMain } from "../src/domain/random-choice";
import { buildReceipt } from "../src/domain/receipt";
import { TableSettings } from "../src/components/table-settings";
import { VotePanel } from "../src/components/vote-panel";
import { TacitReceipt } from "../src/components/tacit-receipt";
import { LiveMenuPanel } from "../src/components/live-menu-panel";
import { BudgetControl } from "../src/components/budget-control";
import { BuddyDiscovery } from "../src/components/buddy-discovery";
import { LocalAccountPanel } from "../src/components/local-account-panel";
import { useRemoteWorkspace } from "../src/client/workspace-mode";
import { SharedTablePanel } from "../src/components/shared-table-panel";
import type { SharedCatalogData, SharedImport, SharedTable } from "../src/domain/shared-table";
import { sharedCheckoutRef, sharedSelectionCurrent } from "../src/domain/shared-table";
import { MEMBER_COLORS } from "../src/domain/members";
import type {
  DrinkChoice,
  FriesChoice,
  MainChoice,
  Preferences,
  Member,
  PaymentPolicy,
} from "../src/domain/types";

function FoodArt() {
  return (
    <svg viewBox="0 0 260 180" role="img" aria-label="原创汉堡与薯条餐盘插画">
      <ellipse cx="124" cy="142" rx="105" ry="25" fill="#e9dfc9" />
      <ellipse
        cx="120"
        cy="133"
        rx="105"
        ry="29"
        fill="#fffaf0"
        stroke="#e9ddc4"
        strokeWidth="2"
      />
      <g transform="translate(156 20) rotate(9 30 70)">
        {[0, 1, 2, 3, 4].map((n) => (
          <rect
            key={n}
            x={n * 11}
            y={10 + (n % 2) * 7}
            width="9"
            height="70"
            rx="3"
            fill={n % 2 ? "#f5bf4e" : "#ffcf61"}
          />
        ))}
        <path d="M-3 58 L59 58 L50 119 Q27 132 6 119 Z" fill="#ce4935" />
        <circle cx="28" cy="88" r="12" fill="#fff5db" />
        <path
          d="M21 89l5 5 9-12"
          fill="none"
          stroke="#ce4935"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(23 43)">
        <path
          d="M1 55C3-5 115-5 119 55Z"
          fill="#eeb459"
          stroke="#d99b42"
          strokeWidth="2"
        />
        <g stroke="#fff0bf" strokeWidth="4" strokeLinecap="round">
          <path d="M26 27l6-3M52 17l5 1M77 22l4 3M96 37l5-1M41 40l4-2" />
        </g>
        <path
          d="M1 62l14-4 13 8 18-7 15 8 18-9 14 7 25-5v13H1Z"
          fill="#75965b"
        />
        <rect y="73" width="120" height="14" rx="7" fill="#714d39" />
        <path d="M8 70h104L79 87 58 78 30 87Z" fill="#ffd260" />
        <path
          d="M0 91h120c-2 25-115 25-120 0Z"
          fill="#eeb459"
          stroke="#d99b42"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}
const mainLabels: Record<MainChoice, string> = {
  chicken: "鸡肉堡",
  beef: "牛肉堡",
  fish: "鱼排堡",
};
const drinkLabels: Record<DrinkChoice, string> = {
  none: "不需要",
  cola: "可乐",
  coffee: "咖啡",
};
const friesLabels: Record<FriesChoice, string> = {
  must: "一定要",
  nice: "有就更好",
  no: "不用啦",
};
const INITIAL_MEMBERS = DEMO_MEMBERS.map((m) => ({
  ...m,
  preferences: { ...m.preferences, budgetCents: 5000 },
}));

export default function Home() {
  const remote = useRemoteWorkspace();
  const [sharedCatalog, setSharedCatalog] = useState<SharedCatalogData | null>(null);
  const [sharedTable, setSharedTable] = useState<SharedTable | null>(null);
  const [sharedImport, setSharedImport] = useState<SharedImport | null>(null);
  const [importingShared, setImportingShared] = useState(false);
  const [importedRevision, setImportedRevision] = useState<number | null>(null);
  const sharedGuest = !!sharedTable && !sharedTable.isHost;
  const [room, setRoom] = useState(() => createDemoRoom(INITIAL_MEMBERS));
  const displayMembers = sharedTable ? sharedTable.members.map((m, i) => ({ ...m, color: MEMBER_COLORS[i] })) : room.members;
  const [useLive, setUseLive] = useState(!remote);
  const [entry, setEntry] = useState<"friends" | "city">("friends");
  const [liveReset, setLiveReset] = useState(0);
  const [accountRevision, setAccountRevision] = useState<number | null>(null);
  const [activeId, setActiveId] = useState("a");
  const [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [receipt, setReceipt] = useState("");
  const receiveSharedTable = useCallback((table: SharedTable | null) => {
    setSharedTable(table);
    if (!table) { setSharedImport(null); setImportingShared(false); setImportedRevision(null); setLiveReset(n => n + 1); }
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const active = room.members.find((m) => m.id === activeId)!;
  const selected = room.plans.find((p) => p.id === room.selectedPlanId);
  const confirmed = room.members.filter(
    (m) => room.confirmations[m.id] === room.proposalVersion,
  );
  const expired = !!selected && now >= selected.quote.expiresAt;
  const allConfirmed = room.phase === "confirmed" && !expired;
  const voting = room.vote.phase === "open" || room.vote.phase === "closed";
  const totalBudget =
    room.payment.mode === "treat"
      ? room.payment.totalBudgetCents
      : room.members.reduce((sum, m) => sum + m.preferences.budgetCents, 0);

  function edit(patch: Partial<Preferences>) {
    try {
      setRoom(updatePreference(room, activeId, patch));
      setConflicts([]);
      setReceipt("");
      setNotice(
        useLive
          ? "预算已更新，真实餐单需要重新核价。"
          : selected
            ? "偏好已更新，旧方案、投票与确认已撤销。请重新生成餐单。"
            : "偏好已保存到本次演示。",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function importShared(draft: SharedImport) {
    const members = draft.members.map((m, i): Member => ({ id: m.id, name: m.name, color: MEMBER_COLORS[i], preferences: { budgetCents: m.budgetCents, main: "chicken", drink: "none", fries: "no", acceptsSharing: false } }));
    setRoom(current => replaceRoster(current, members, 1));
    setActiveId(members.some(m => m.id === sharedTable?.myMemberId) ? sharedTable!.myMemberId : members[0].id);
    setEntry("friends"); setUseLive(true); setImportedRevision(null); setImportingShared(true); setSharedImport(draft);
    setNotice(`正在载入本次结算：${draft.members.map(m => m.name).join("、")}。优惠券由付款人自己的账户决定。`);
    requestAnimationFrame(() => document.getElementById("room-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function applyRoster(members: Member[]) {
    setLiveReset((n) => n + 1);
    setRoom(replaceRoster(room, members));
    setActiveId(members[0].id);
    setReceipt("");
    setConflicts([]);
    setNotice(`已应用 ${members.length} 人餐桌，旧方案、投票和确认已清空。`);
  }
  function applyPayment(payment: PaymentPolicy) {
    try {
      setRoom(updatePayment(room, payment));
      setReceipt("");
      setConflicts([]);
      setNotice(
        payment.mode === "treat"
          ? `已应用请客模式，整桌预算 ${formatMoney(payment.totalBudgetCents)}。请重新生成方案。`
          : "已改为各付各的，请重新生成方案。",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function randomMain() {
    try {
      const main = chooseRandomMain(room, activeId, DEMO_MENU);
      edit({ main });
      setNotice(
        `帮${active.name}选了${mainLabels[main]}，饮料与薯条要求不变。你仍可修改，稍后需要亲自确认。`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function toggleExclusion(main: MainChoice) {
    const old = active.preferences.excludedMains ?? [];
    const next = old.includes(main)
      ? old.filter((m) => m !== main)
      : [...old, main];
    const allowed = (Object.keys(mainLabels) as MainChoice[]).filter(
      (m) => !next.includes(m),
    );
    if (!allowed.length) {
      setNotice("至少保留一种可选主餐。");
      return;
    }
    const newMain = next.includes(active.preferences.main)
      ? allowed[0]
      : active.preferences.main;
    edit({ excludedMains: next, main: newMain });
    if (newMain !== active.preferences.main)
      setNotice(
        `已排除${mainLabels[main]}，当前主餐改为${mainLabels[newMain]}，可继续调整。`,
      );
  }
  function generate() {
    try {
      const result = buildDemoPlans(
        room.members,
        DEMO_MENU,
        room.revision,
        Date.now(),
        room.payment,
      );
      setConflicts(result.conflicts);
      if (result.plans.length) {
        setRoom(proposePlans(room, result.plans));
        setNotice(
          `已生成 ${result.plans.length} 套不同方案，切换样例成员即可体验逐人确认。`,
        );
      } else {
        setRoom((previous) => ({
          ...previous,
          plans: [],
          selectedPlanId: null,
          confirmations: {},
          phase: "collecting",
          vote: { round: previous.vote.round + 1, phase: "idle", ballots: {} },
        }));
        setNotice("暂时没有满足所有必选项和预算的方案，请查看下方原因。");
      }
      setReceipt("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成失败");
    }
  }
  function choose(id: string) {
    try {
      setRoom(selectPlan(room, id));
      if (id !== room.selectedPlanId)
        setNotice("已切换餐单，请大家确认新方案。");
      setReceipt("");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function confirm() {
    try {
      if (room.confirmations[activeId] === room.proposalVersion) {
        setRoom(revokeConfirmation(room, activeId));
        setNotice(`${active.name}已撤销确认。`);
      } else {
        setRoom(confirmPlan(room, activeId, room.proposalVersion));
        setNotice(`${active.name}已确认这份演示餐单。`);
      }
      setReceipt("");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function copyReceipt() {
    if (!selected || !allConfirmed || selected.quote.expiresAt <= Date.now())
      return;
    const body = buildReceipt(room).text;
    setReceipt(body);
    try {
      await navigator.clipboard.writeText(body);
      setNotice("演示餐单已复制，也可以从下方文本框手动复制。");
    } catch {
      setNotice("浏览器未允许自动复制，可从下方文本框手动复制。");
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="/" className="brand" aria-label="麦麦合拍首页">
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          <strong>
            麦麦合拍<span>MAIMAI TOGETHER</span>
          </strong>
        </a>
        <nav aria-label="主导航">
          <a href="/design">
            功能与设计方案 <ChevronRight size={14} />
          </a>
          <span className="demo-badge">
            <span />{" "}
            {sharedGuest ? "共享餐桌 · 自动同步" : entry === "city"
              ? "同城匹配 · 演示"
              : useLive
                ? remote ? "真实菜单 · 我的授权" : "真实菜单 · 本机"
                : "合拍演示"}
          </span>
          <LocalAccountPanel onAccount={setAccountRevision} />
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> 少一点「随便」，多一点合拍
            </div>
            <h1>
              这顿，
              <br />
              大家都<span className="red-word">合拍。</span>
            </h1>
            <p>
              每个人的小心愿，都值得被认真安排。
              <br />
              一起选餐、一起确认，把午餐变成一件轻松的事。
            </p>
            <div className="hero-foot">
              {displayMembers.map((m) => (
                <span key={m.id} className={`mini-avatar ${m.color}`}>
                  {m.name.slice(-1)}
                </span>
              ))}
              <span>{displayMembers.length} 位饭搭子 · 一张合拍餐单</span>
            </div>
          </div>
          <div className="table-visual">
            <div className="visual-note">ONE TABLE. EVERYONE HAPPY.</div>
            <div className="food-art">
              <FoodArt />
            </div>
            <div className="speech speech-one">
              <Heart size={13} fill="currentColor" /> 我的薯条不能少
            </div>
            <div className="speech speech-two">
              <Coffee size={14} /> 咖啡安排上
            </div>
            <div className="table-caption">
              <span>今日合拍局</span>
              <strong>好好吃饭，慢慢商量。</strong>
            </div>
            <span className="visual-dot dot-one" />
            <span className="visual-dot dot-two" />
          </div>
        </section>
        <SharedTablePanel catalog={sharedCatalog} onSnapshot={receiveSharedTable} onImport={importShared} importing={importingShared} importedRevision={importedRevision} />
        <div
          className="meal-entry-switch"
          role="group"
          aria-label="选择合拍入口"
        >
          <button
            aria-pressed={entry === "friends"}
            className={entry === "friends" ? "selected" : ""}
            onClick={() => setEntry("friends")}
          >
            <Users size={19} />
            <span>
              和朋友合拍<small>熟悉的饭搭子，一起选餐</small>
            </span>
          </button>
          <button
            aria-pressed={entry === "city"}
            className={entry === "city" ? "selected" : ""}
            onClick={() => setEntry("city")}
          >
            <Heart size={19} />
            <span>
              同城找搭子<small>认识新朋友 · 匹配演示</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </div>
        <div hidden={entry !== "city"}>
          <BuddyDiscovery onReturn={() => setEntry("friends")} />
        </div>
        {!sharedGuest && <div hidden={entry !== "friends"}>
          <div className="prototype-notice">
            <span className="notice-tag">体验说明</span>
            <p>
              {useLive
                ? "这里读取当前门店的真实商品和可用券。朋友通过上方共享餐桌独立选餐，发起人汇总后统一核价；也可以直接代大家选餐。投票、随便选餐和小票在「合拍演示」中体验。"
                : "合拍演示使用虚构类别和价格，体验投票、随便选餐与默契小票。需要具体商品，请切回「真实点餐」。"}
            </p>
          </div>
          <section className="room-section" aria-labelledby="room-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">OUR LUNCH TABLE</span>
                <h2 id="room-heading">{sharedImport ? "核对本次结算，准备下单。" : "今天中午，一起吃点好。"}</h2>
              </div>
              <button
                className="text-button"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={15} /> 重置餐桌
              </button>
            </div>
            <div className="room-meta">
              <span>
                <Users size={15} /> {room.members.length} 人小聚
              </span>
              <span>
                <Utensils size={15} /> {useLive ? "门店实时菜单" : "演示餐厅"} ·
                到店自取
              </span>
              <span>
                {room.payment.mode === "treat" ? "请客预算" : "合计预算"}{" "}
                <strong>{formatMoney(totalBudget)}</strong>
              </span>
            </div>
            {!sharedImport && <TableSettings
              room={room}
              onRoster={applyRoster}
              onPayment={applyPayment}
              onNotice={setNotice}
            />}
            {notice && (
              <p className="table-notice" aria-live="polite">
                {notice}
              </p>
            )}
            {!sharedImport && <div
              className="menu-mode-switch"
              role="group"
              aria-label="选餐模式"
            >
              <button
                className={useLive ? "selected" : ""}
                aria-pressed={useLive}
                onClick={() => {
                  setUseLive(true);
                  setNotice("");
                }}
              >
                真实点餐 <small>具体商品 · 官方核价</small>
              </button>
              <button
                className={!useLive ? "selected" : ""}
                aria-pressed={!useLive}
                onClick={() => {
                  setUseLive(false);
                  setNotice("");
                }}
              >
                合拍演示 <small>虚构样例 · 投票与小票</small>
              </button>
            </div>}
            {!useLive && (
              <ol className="steps" aria-label="当前进度">
                <li className="done">
                  <span>01</span> 每人说说想吃什么
                </li>
                <li className={selected ? "done" : ""}>
                  <span>02</span> 找到合拍方案
                </li>
                <li className={allConfirmed ? "done" : ""}>
                  <span>03</span> 大家确认，准备开饭
                </li>
              </ol>
            )}
            <div
              className="member-switcher"
              role="group"
              aria-label="切换演示成员"
            >
              {room.members.map((member) => (
                <button
                  key={member.id}
                  className={`member-button ${member.id === activeId ? "active" : ""}`}
                  aria-pressed={member.id === activeId}
                  onClick={() => {
                    setActiveId(member.id);
                    setNotice(`现在以${member.name}的视角体验。`);
                  }}
                >
                  <span className={`avatar ${member.color}`}>
                    {member.name.slice(-1)}
                  </span>
                  <span className="member-label">
                    <strong>
                      {member.name}
                      {!sharedImport && member.id === room.members[0].id && (
                        <small>发起人</small>
                      )}
                    </strong>
                    <span>
                      {!useLive &&
                      room.confirmations[member.id] === room.proposalVersion &&
                      selected ? (
                        <>
                          <Check size={12} /> 已确认餐单
                        </>
                      ) : room.payment.mode === "treat" ? (
                        member.id === room.payment.payerId ? (
                          "这顿我请客"
                        ) : (
                          "有人请客，放心选"
                        )
                      ) : (
                        `${formatMoney(member.preferences.budgetCents)} 以内`
                      )}
                    </span>
                  </span>
                  {member.id === activeId && (
                    <span className="viewing-label">当前视角</span>
                  )}
                </button>
              ))}
            </div>
            {useLive ? (
              accountRevision === null ? <p className="prototype-notice">正在读取工作区账号与数据库状态，请稍候。</p> :
              <LiveMenuPanel
                key={accountRevision}
                accountRevision={accountRevision}
                onCatalog={setSharedCatalog}
                sharedImport={sharedImport}
                sharedChanged={!!sharedImport && (!sharedTable || !sharedSelectionCurrent(sharedTable, sharedCheckoutRef(sharedImport), now))}
                onImported={revision => { setImportedRevision(revision); setImportingShared(false); setNotice(revision === null ? "汇总未完成，请检查下方提示后重试。" : "已汇总所选成员的餐品与预算，请核对后官方核价。朋友的卡券不会自动合并。"); }}
                room={room}
                activeId={activeId}
                resetKey={liveReset}
                onBudget={(budgetCents) => edit({ budgetCents })}
              />
            ) : (
              <div className="workspace">
                <aside className="preferences-panel">
                  <div className="panel-heading">
                    <h3>{active.name}的小心愿</h3>
                    <span>仅本次演示</span>
                  </div>
                  <p className="subtle">选好你的这一份，剩下的交给餐桌。</p>
                  {room.payment.mode === "split" ? (
                    <BudgetControl
                      value={active.preferences.budgetCents}
                      onChange={(budgetCents) => edit({ budgetCents })}
                    />
                  ) : (
                    <div className="treat-note">
                      这顿由
                      <strong>
                        {
                          room.members.find(
                            (m) =>
                              room.payment.mode === "treat" &&
                              m.id === room.payment.payerId,
                          )!.name
                        }
                      </strong>
                      请客。你只管表达口味，系统会守住整桌{" "}
                      {formatMoney(totalBudget)} 的预算。
                    </div>
                  )}
                  <fieldset>
                    <legend>
                      主餐想吃什么？<small>必选</small>
                    </legend>
                    <div className="segmented">
                      {Object.entries(mainLabels).map(([key, label]) => (
                        <button
                          key={key}
                          disabled={active.preferences.excludedMains?.includes(
                            key as MainChoice,
                          )}
                          aria-pressed={active.preferences.main === key}
                          className={
                            active.preferences.main === key ? "selected" : ""
                          }
                          onClick={() => edit({ main: key as MainChoice })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="random-choice">
                      <button className="outline-button" onClick={randomMain}>
                        <Shuffle size={15} /> 随便，帮我选主餐
                      </button>
                      <p>只代选主餐，保留饮料、薯条和预算。下面勾选不吃的：</p>
                      <div className="exclusion-options">
                        {Object.entries(mainLabels).map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={
                                active.preferences.excludedMains?.includes(
                                  key as MainChoice,
                                ) ?? false
                              }
                              onChange={() =>
                                toggleExclusion(key as MainChoice)
                              }
                            />
                            不吃{label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>
                      再配一杯？<small>按你的选择安排</small>
                    </legend>
                    <div className="segmented">
                      {Object.entries(drinkLabels).map(([key, label]) => (
                        <button
                          key={key}
                          aria-pressed={active.preferences.drink === key}
                          className={
                            active.preferences.drink === key ? "selected" : ""
                          }
                          onClick={() => edit({ drink: key as DrinkChoice })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>薯条对你有多重要？</legend>
                    <div className="segmented">
                      {Object.entries(friesLabels).map(([key, label]) => (
                        <button
                          key={key}
                          aria-pressed={active.preferences.fries === key}
                          className={
                            active.preferences.fries === key ? "selected" : ""
                          }
                          onClick={() => edit({ fries: key as FriesChoice })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="sharing-toggle">
                    <input
                      type="checkbox"
                      checked={active.preferences.acceptsSharing}
                      onChange={(e) =>
                        edit({ acceptsSharing: e.target.checked })
                      }
                    />
                    <span>
                      <strong>我愿意和大家分享小食</strong>
                      <small>「一定要」的薯条仍会单独安排</small>
                    </span>
                  </label>
                  <div className="preference-footer">
                    <Check size={14} /> 改动后会重新计算，旧确认自动撤销
                  </div>
                </aside>
                <div className="plans-panel">
                  <div className="plan-heading">
                    <div>
                      <span className="eyebrow">
                        A LITTLE CHOICE, A LOT OF JOY
                      </span>
                      <h3>总有一桌，刚刚好。</h3>
                    </div>
                    <button className="primary-button" onClick={generate}>
                      <Sparkles size={16} />{" "}
                      {selected ? "重新生成" : "生成合拍方案"}
                    </button>
                  </div>
                  <div
                    className={`live-notice ${conflicts.length ? "error-notice" : ""}`}
                    role="status"
                  >
                    {notice || "先调整每个人的偏好，再生成你们的合拍方案。"}
                  </div>
                  {conflicts.length > 0 && (
                    <div className="conflict-box">
                      <strong>先商量一下这几个小分歧</strong>
                      <ul>
                        {conflicts.map((conflict) => (
                          <li key={conflict}>{conflict}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!selected ? (
                    <div className="empty-plans">
                      <div className="empty-plates">
                        <span>
                          <Utensils size={23} />
                        </span>
                        <span>
                          <Heart size={25} />
                        </span>
                        <span>
                          <Coffee size={23} />
                        </span>
                      </div>
                      <h4>每一个「我想要」，都算数。</h4>
                      <p>
                        最多三套方案，清楚列出每个人吃什么、花多少。
                        <br />
                        无法满足的地方，也会认真告诉你。
                      </p>
                      <button className="text-button red" onClick={generate}>
                        帮我们拼一桌 <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      {expired && (
                        <div className="conflict-box">
                          演示报价已超过 5 分钟，请重新生成方案后确认。
                        </div>
                      )}
                      <div className="plan-options">
                        {room.plans.map((plan, i) => (
                          <button
                            key={plan.id}
                            className={`plan-option ${selected.id === plan.id ? "chosen" : ""}`}
                            aria-pressed={selected.id === plan.id}
                            onClick={() => choose(plan.id)}
                            disabled={expired || voting}
                          >
                            <div className="option-top">
                              <span>方案 0{i + 1}</span>
                              <span className="radio-dot">
                                {selected.id === plan.id && <Check size={11} />}
                              </span>
                            </div>
                            <strong>{plan.title}</strong>
                            <p>{plan.description}</p>
                            <div className="option-price">
                              {formatMoney(plan.quote.totalCents)}
                              <small> / 整桌</small>
                            </div>
                            <span className="demo-price">演示金额</span>
                          </button>
                        ))}
                      </div>
                      <VotePanel
                        room={room}
                        activeId={activeId}
                        expired={expired}
                        onNotice={setNotice}
                        onChange={(next) => {
                          setRoom(next);
                          setReceipt("");
                        }}
                      />
                      <div className="allocation-heading">
                        <h4>看看每个人的餐盘</h4>
                        <span>
                          餐单 v{room.proposalVersion} ·{" "}
                          {room.payment.mode === "treat"
                            ? "请客人承担整桌费用"
                            : "共享项目均分"}
                        </span>
                      </div>
                      <div className="allocation-list">
                        {selected.allocations.map((allocation) => {
                          const member = room.members.find(
                            (m) => m.id === allocation.memberId,
                          )!;
                          return (
                            <div
                              className={`allocation-row ${member.id === activeId ? "my-allocation" : ""}`}
                              key={member.id}
                            >
                              <span className={`avatar small ${member.color}`}>
                                {member.name.slice(-1)}
                              </span>
                              <div className="allocation-content">
                                <strong>
                                  {member.name}{" "}
                                  {member.id === activeId && (
                                    <small>当前视角</small>
                                  )}
                                </strong>
                                <p>
                                  {allocation.items.map((item) => (
                                    <span key={item.name}>
                                      {item.name.replace("（示例）", "")}
                                      {item.shared ? " · 共享" : ""}
                                    </span>
                                  ))}
                                </p>
                                {allocation.notes.map((note) => (
                                  <small className="optional-note" key={note}>
                                    {note}
                                  </small>
                                ))}
                              </div>
                              <div className="allocation-price">
                                <strong>
                                  应付 {formatMoney(allocation.payableCents)}
                                </strong>
                                <span>
                                  {room.payment.mode === "treat" ? (
                                    `餐品 ${formatMoney(allocation.totalCents)}`
                                  ) : (
                                    <>
                                      预算余量{" "}
                                      {formatMoney(
                                        member.preferences.budgetCents -
                                          allocation.totalCents,
                                      )}
                                    </>
                                  )}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="total-line">
                        <span>
                          整桌合计 <small>虚构演示价 · 无优惠及额外费用</small>
                        </span>
                        <strong>
                          {formatMoney(selected.quote.totalCents)}
                        </strong>
                      </div>
                      <div
                        className={`consensus-box ${allConfirmed ? "complete" : ""}`}
                      >
                        <div>
                          <span className="consensus-icon">
                            {allConfirmed ? (
                              <CheckCheck size={22} />
                            ) : (
                              <Users size={22} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {allConfirmed
                                ? "这一桌，大家都合拍！"
                                : `${confirmed.length} / ${room.members.length} 位饭搭子已确认`}
                            </strong>
                            <p>
                              {allConfirmed
                                ? "演示流程完成，默契小票已解锁。"
                                : `现在是${active.name}的视角，确认的是当前餐单与本人金额。`}
                            </p>
                          </div>
                        </div>
                        <button
                          className="dark-button"
                          disabled={expired || voting}
                          onClick={confirm}
                        >
                          {room.confirmations[activeId] === room.proposalVersion
                            ? "撤销我的确认"
                            : "我同意这份餐单"}
                          <Check size={15} />
                        </button>
                      </div>
                      <div className="receipt-actions">
                        <span>提示：切换上方成员，体验每个人的确认过程。</span>
                        <button
                          className="text-button"
                          disabled={!allConfirmed}
                          onClick={copyReceipt}
                        >
                          <Clipboard size={15} /> 复制分账清单
                        </button>
                      </div>
                      {allConfirmed && (
                        <TacitReceipt room={room} onNotice={setNotice} />
                      )}
                      {receipt && allConfirmed && (
                        <label className="receipt-output">
                          演示餐单文本
                          <textarea readOnly value={receipt} rows={9} />
                        </label>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>}
        <section className="idea-banner">
          <div>
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2>你的脑洞，也可以加入这一桌。</h2>
            <p>
              请客、投票、随便选餐、默契小票、固定饭搭子，已加入这一桌。
              <br />
              现在可以创建共享餐桌，让朋友各自选择餐品和预算，再由发起人统一核价。
            </p>
          </div>
          <a className="outline-button" href="/design">
            查看设计与扩展方向 <ArrowRight size={17} />
          </a>
        </section>
      </main>
      <footer>
        <span>麦麦合拍 · 让每个人的小心愿，都有位置。</span>
        <span>独立参赛项目原型 · 非麦当劳官方产品</span>
      </footer>
      {resetOpen && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="reset-dialog"
          >
            <button
              className="dialog-close"
              aria-label="关闭重置提示"
              onClick={() => setResetOpen(false)}
            >
              <X size={18} />
            </button>
            <h2 id="reset-title">重新开一桌？</h2>
            <p>
              当前餐单、偏好、方案和确认将重置为四位样例成员的初始设置，每人预算恢复为
              ¥50。
            </p>
            <div>
              <button
                className="outline-button"
                autoFocus
                onClick={() => setResetOpen(false)}
              >
                继续这一桌
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setRoom(createDemoRoom(INITIAL_MEMBERS));
                  setSharedImport(null); setImportedRevision(null); setImportingShared(false);
                  setLiveReset((n) => n + 1);
                  setActiveId("a");
                  setConflicts([]);
                  setReceipt("");
                  setNotice("已重置，可以从新的想法开始。");
                  setResetOpen(false);
                }}
              >
                重置演示
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
