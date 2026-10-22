"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { localApi } from "../client/local-api";
import { useRemoteWorkspace } from "../client/workspace-mode";
import {
  ArrowRight,
  Check,
  Clock,
  Heart,
  MapPin,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  matchBuddyParties,
  transitionBuddyApplication,
  type BuddyApplicationState,
  type BuddyParty,
  type BuddySearch,
  type MealWindow,
  type BuddyPayment,
  MEAL_WINDOWS,
  BUDDY_TAGS,
} from "../domain/buddy-matching";
import { DEMO_BUDDY_PARTIES } from "../providers/buddy-demo";
import { formatMoney } from "../domain/money";
import { BuddyPublisher } from "./buddy-publisher";
import {
  MAX_PUBLISHED_BUDDIES,
  PUBLISHED_BUDDIES_KEY,
  parsePublishedBuddies,
  setPublishedBuddyClosed,
  type PublishedBuddyParty,
} from "../domain/buddy-publishing";

const WINDOWS = MEAL_WINDOWS;
const TAGS = BUDDY_TAGS;
type Application = {
  party: BuddyParty;
  budgetCents: number;
  state: BuddyApplicationState;
};

export function BuddyDiscovery({ onReturn }: { onReturn: () => void }) {
  const remote = useRemoteWorkspace();
  const [city, setCity] = useState("上海市");
  const [area, setArea] = useState("");
  const [window, setWindow] = useState<MealWindow>("lunch");
  const [budget, setBudget] = useState("50");
  const [capacity, setCapacity] = useState("");
  const [payment, setPayment] = useState<BuddyPayment>("separate");
  const [tags, setTags] = useState<string[]>(["轻松聊天"]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [application, setApplication] = useState<Application | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"search" | "mine">("search");
  const [editorId, setEditorId] = useState<string | null>(null);
  const [mealDate, setMealDate] = useState("");
  const [published, setPublished] = useState<PublishedBuddyParty[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const revision = useRef(-1);
  const saving = useRef(false);
  const [mutating, setMutating] = useState(false);
  const [now, setNow] = useState(Date.now());
  type Snapshot = { parties: PublishedBuddyParty[]; revision: number };
  const acceptSnapshot = useCallback((snapshot: Snapshot) => {
    if (snapshot.revision < revision.current) return;
    revision.current = snapshot.revision;
    setPublished(snapshot.parties);
    setStorageReady(true);
  }, []);
  const refreshRecords = useCallback(async () => {
    try {
      acceptSnapshot(await localApi<Snapshot>({ action: "parties" }));
      setStorageError("");
    } catch (error) { setStorageError((error as Error).message); }
  }, [acceptSnapshot]);
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const existing = await localApi<Snapshot>({ action: "parties" });
        if (!active) return;
        acceptSnapshot(existing);
        let legacy: PublishedBuddyParty[];
        try { legacy = parsePublishedBuddies(localStorage.getItem(PUBLISHED_BUDDIES_KEY)); }
        catch { setNotice("旧浏览器记录无法解析，原数据未改动；可继续使用数据库中的饭局。"); return; }
        if (legacy.length) {
          const imported = await localApi<Snapshot & { imported: number }>({ action: "import-parties", parties: legacy });
          if (!active) return;
          acceptSnapshot(imported);
          if (imported.imported) setNotice(`已将 ${imported.imported} 条旧发布迁入工作区数据库，浏览器原记录保留作备份。`);
        }
      } catch (error) {
        if (active) setStorageError((error as Error).message);
      }
    };
    void initialize();
    const focus = () => void refreshRecords();
    globalThis.addEventListener("focus", focus);
    const timer = setInterval(() => { setNow(Date.now()); if (!saving.current) void refreshRecords(); }, 10000);
    return () => {
      active = false;
      globalThis.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [acceptSnapshot, refreshRecords]);
  async function persist(
    update: (current: PublishedBuddyParty[]) => PublishedBuddyParty[],
  ) {
    if (!storageReady) throw new Error("工作区发布记录未就绪，请刷新后重试。");
    if (saving.current) throw new Error("上一项修改正在保存，请稍后再试。");
    saving.current = true;
    setMutating(true);
    try {
      const current = await localApi<Snapshot>({ action: "parties" });
      acceptSnapshot(current);
      const next = update(current.parties);
      acceptSnapshot(await localApi<Snapshot>({ action: "save-parties", revision: current.revision, parties: next }));
      setStorageError("");
    } finally { saving.current = false; setMutating(false); }
  }
  async function saveParty(
    party: PublishedBuddyParty,
    previous?: PublishedBuddyParty,
  ) {
    await persist((current) => {
      if (previous) {
        const latest = current.find((p) => p.id === previous.id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(previous)) {
          setPublished(current);
          throw new Error("这条饭局已在别处修改，请关闭编辑器后重新打开。");
        }
        return current.map((p) => (p.id === party.id ? party : p));
      }
      if (current.length >= MAX_PUBLISHED_BUDDIES)
        throw new Error("每个工作区最多保存 20 个饭局。");
      return [party, ...current];
    });
    setEditorId(null);
    setNotice(
      previous
        ? "饭局修改已保存到工作区。"
        : "已保存到工作区数据库，重启后仍保留；尚未公开给其他用户。",
    );
  }
  async function closeParty(party: PublishedBuddyParty, closed: boolean) {
    try {
      await persist((current) => {
        const latest = current.find((p) => p.id === party.id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(party))
          throw new Error("饭局记录已变化，请刷新查看最新状态。");
        const next = setPublishedBuddyClosed(latest, closed);
        return current.map((p) => (p.id === party.id ? next : p));
      });
      setNotice(
        closed
          ? "已取消招募，这条饭局不再出现在寻找列表中；记录保留，可在我的发布中重新招募。"
          : "已在当前工作区重新开放招募。",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作未保存，请重试。");
    }
  }
  function browseParty(party: PublishedBuddyParty) {
    setCity(party.city);
    setArea(party.area);
    setWindow(party.window);
    setMealDate(party.mealDate);
    setBudget(String(party.maxBudgetCents / 100));
    setCapacity(String(party.capacity));
    setPayment(party.payment);
    setHidden(hidden.filter((id) => id !== party.id));
    setView("search");
    setNotice("已按这条饭局的条件展示列表。你是发起人，可在“我的发布”中管理。");
  }
  const budgetValid =
    /^\d+(\.\d{1,2})?$/.test(budget) &&
    Number(budget) >= 1 &&
    Number(budget) <= 1000;
  const search: BuddySearch = {
    city,
    area,
    window,
    budgetCents: budgetValid ? Math.round(Number(budget) * 100) : 0,
    capacity: capacity ? Number(capacity) : null,
    tags,
    payment,
    mealDate,
  };
  const matches = matchBuddyParties(
    [...published, ...DEMO_BUDDY_PARTIES],
    search,
    hidden,
    now,
  );
  const activeApplication =
    application?.state === "pending" || application?.state === "accepted";
  function request(party: BuddyParty) {
    if (published.some((p) => p.id === party.id)) return;
    if (activeApplication || !matches.some((m) => m.party.id === party.id))
      return;
    setApplication({
      party,
      budgetCents: search.budgetCents,
      state: "pending",
    });
    setNotice("已记录演示申请，等待你模拟对方的决定。没有向真实用户发送消息。");
  }
  function decide(action: "accept" | "decline" | "withdraw") {
    if (!application) return;
    setApplication({
      ...application,
      state: transitionBuddyApplication(application.state, action),
    });
    setNotice(
      action === "accept"
        ? "演示双方已同意，下面可以预览这次饭局。尚未创建真实多人房间。"
        : action === "decline"
          ? "已模拟对方婉拒，可以再看看其他饭局。"
          : "已退出这次演示申请，可以重新匹配。",
    );
  }
  return (
    <section className="buddy-discovery" aria-labelledby="buddy-heading">
      <div className="buddy-intro">
        <div>
          <span className="eyebrow">MEET OVER A MEAL</span>
          <h2 id="buddy-heading">同一座城，刚好一起吃。</h2>
          <p>先找时间、预算和节奏合得来的人，再决定这顿怎么吃。</p>
        </div>
        <button
          className="primary-button"
          disabled={!storageReady}
          onClick={() => {
            setView("mine");
            setEditorId("new");
            setNotice("");
          }}
        >
          <Plus size={17} /> 发布找搭子
        </button>
      </div>
      <p className="prototype-notice buddy-demo-note">
        同城匹配目前为演示。示例搭子均为虚构；你的饭局保存到{remote ? "发起人电脑上的独立工作区" : "本机数据库"}，尚未对外公开。申请不会联系真实用户。
      </p>
      <div className="buddy-view-tabs" role="group" aria-label="寻找与发布">
        <button
          aria-pressed={view === "search"}
          className={view === "search" ? "selected" : ""}
          onClick={() => setView("search")}
        >
          寻找饭局
        </button>
        <button
          aria-pressed={view === "mine"}
          className={view === "mine" ? "selected" : ""}
          onClick={() => setView("mine")}
        >
          我的发布 <span>{published.length}</span>
        </button>
      </div>
      {storageError && (
        <p role="alert" className="error-notice">
          {storageError}
          <button className="text-button" onClick={() => void refreshRecords()}>重试读取数据库</button>
        </p>
      )}
      {notice && (
        <p className="table-notice" role="status">
          {notice}
        </p>
      )}
      <div hidden={view !== "mine"}>
        <BuddyPublisher
          parties={published}
          editorId={editorId}
          ready={storageReady && !mutating}
          city={city}
          area={area}
          now={now}
          onEditor={setEditorId}
          onSave={saveParty}
          onClose={closeParty}
          onBrowse={browseParty}
        />
      </div>
      <div hidden={view !== "search"}>
        <div className="buddy-layout">
          <section className="buddy-filters" aria-label="搭子匹配条件">
            <h3>
              <Search size={18} /> 你想约怎样的一顿？
            </h3>
            <div className="buddy-fields">
              <label>
                所在城市
                <input
                  aria-label="匹配城市"
                  value={city}
                  maxLength={30}
                  onChange={(e) => setCity(e.target.value)}
                />
              </label>
              <label>
                商圈或区域
                <input
                  aria-label="匹配商圈"
                  value={area}
                  placeholder="不限，或输入黄浦"
                  maxLength={60}
                  onChange={(e) => setArea(e.target.value)}
                />
              </label>
              <label>
                用餐时间
                <select
                  aria-label="匹配时间"
                  value={window}
                  onChange={(e) => setWindow(e.target.value as MealWindow)}
                >
                  {Object.entries(WINDOWS).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                用餐日期（不选则不限）
                <input
                  aria-label="匹配用餐日期"
                  type="date"
                  value={mealDate}
                  onInput={(e) => setMealDate(e.currentTarget.value)}
                  onChange={(e) => setMealDate(e.target.value)}
                />
              </label>
              <label>
                我的预算上限（元）
                <input
                  aria-label="匹配预算上限"
                  type="number"
                  min={1}
                  max={1000}
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  aria-invalid={!budgetValid}
                />
              </label>
              <label>
                想要几人局
                <select
                  aria-label="匹配饭局人数"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                >
                  <option value="">人数不限</option>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} 人局
                    </option>
                  ))}
                </select>
              </label>
              <label>
                下单方式
                <select
                  aria-label="匹配下单方式"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value as BuddyPayment)}
                >
                  <option value="separate">各自下单，一起吃</option>
                  <option value="host">协商一人代付，再分账</option>
                </select>
              </label>
            </div>
            {!budgetValid && (
              <p className="error-notice" role="alert">
                请输入 1—1000 元，最多两位小数。
              </p>
            )}
            <p className="setting-hint">
              喜欢怎样的相处方式？可多选，优先推荐共同偏好。
            </p>
            <div className="buddy-tags" role="group" aria-label="搭子偏好">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  aria-pressed={tags.includes(tag)}
                  className={tags.includes(tag) ? "selected" : ""}
                  onClick={() =>
                    setTags(
                      tags.includes(tag)
                        ? tags.filter((t) => t !== tag)
                        : [...tags, tag],
                    )
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
            <p className="setting-hint">
              预算只用于找合适的饭局，最终餐费还要按各自的餐单确认。
            </p>
          </section>
          <section className="buddy-results" aria-label="饭搭子匹配结果">
            <div className="live-section-heading">
              <h3>这些饭局，值得聊聊</h3>
              <span role="status">
                {matches.length} 个符合条件的饭局 · 匹配演示
              </span>
            </div>
            {matches.length === 0 && (
              <div className="live-empty">
                <p>
                  暂时没有符合条件的饭局。试试其他条件，或自己发起一局。示例饭局未指定日期，选择具体日期时只显示你的工作区发布。
                </p>
                <button
                  className="outline-button"
                  disabled={!storageReady}
                  onClick={() => {
                    setView("mine");
                    setEditorId("new");
                  }}
                >
                  发布找搭子
                </button>
              </div>
            )}
            <div className="buddy-cards">
              {matches.map(({ party, reasons }) => {
                const joined =
                  application?.party.id === party.id &&
                  application.state === "accepted";
                const occupied = party.occupied + (joined ? 1 : 0);
                const owned = published.some((p) => p.id === party.id);
                return (
                  <article className="buddy-card" key={party.id}>
                    <div className="buddy-card-top">
                      <span className="buddy-avatar">
                        {party.host.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{party.host}</strong>
                        <small>
                          {owned ? "我的发布 · 未公开" : "虚构搭子"} ·{" "}
                          {party.city}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        aria-label={
                          owned
                            ? "隐藏我的饭局 " + party.title
                            : "隐藏示例 " + party.host
                        }
                        disabled={
                          activeApplication &&
                          application?.party.id === party.id
                        }
                        onClick={() => setHidden([...hidden, party.id])}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <h4>{party.title}</h4>
                    <p>
                      <MapPin size={14} />
                      {party.area}
                    </p>
                    <p>
                      <Clock size={14} />
                      {party.mealDate ? party.mealDate + " · " : ""}
                      {WINDOWS[party.window]}
                    </p>
                    <p>
                      <Users size={14} />
                      {party.capacity} 人局 · 已有 {occupied} 人 · 还差{" "}
                      {party.capacity - occupied} 人
                    </p>
                    <div className="buddy-price">
                      建议 {formatMoney(party.minBudgetCents)}—
                      {formatMoney(party.maxBudgetCents)}
                      <small>
                        {" "}
                        / 人 ·{" "}
                        {party.payment === "separate" ? "各自下单" : "协商代付"}
                      </small>
                    </div>
                    <div className="buddy-reasons">
                      {reasons.map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                    </div>
                    <button
                      className="outline-button"
                      aria-label={
                        owned
                          ? "管理我的饭局 " + party.title
                          : "申请与" + party.host + "一起吃（演示）"
                      }
                      disabled={!owned && activeApplication}
                      onClick={() =>
                        owned
                          ? (setView("mine"), setEditorId(null))
                          : request(party)
                      }
                    >
                      {owned
                        ? "管理我的饭局"
                        : application?.party.id === party.id &&
                            activeApplication
                          ? joined
                            ? "已合拍（演示）"
                            : "申请处理中"
                          : "申请一起吃（演示）"}
                      <ArrowRight size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
            {hidden.length > 0 && (
              <button className="text-button" onClick={() => setHidden([])}>
                恢复隐藏的 {hidden.length} 个示例
              </button>
            )}
          </section>
        </div>
        {application && (
          <section className="buddy-application" aria-label="我的演示申请">
            <div className="live-section-heading">
              <h3>
                <Heart size={18} /> 和 {application.party.host} 的这一顿
              </h3>
              <span className="buddy-demo-label">
                {
                  {
                    pending: "待回应",
                    accepted: "已合拍（演示）",
                    declined: "对方婉拒（演示）",
                    withdrawn: "已退出演示",
                  }[application.state]
                }
              </span>
            </div>
            <p>
              {application.party.area} · {WINDOWS[application.party.window]} ·
              申请时的个人上限 {formatMoney(application.budgetCents)}
            </p>
            {application.state === "pending" && (
              <>
                <p>
                  你已经表达了意愿；对方同意后，才会进入合拍房间。申请并不代表同意代付。
                </p>
                <div className="buddy-actions">
                  <button
                    className="primary-button"
                    onClick={() => decide("accept")}
                  >
                    模拟对方同意
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => decide("decline")}
                  >
                    模拟对方婉拒
                  </button>
                  <button
                    className="text-button"
                    onClick={() => decide("withdraw")}
                  >
                    撤回演示申请
                  </button>
                </div>
              </>
            )}
            {application.state === "accepted" && (
              <>
                <div className="buddy-room-preview">
                  <Check size={20} />
                  <div>
                    <strong>饭局草稿已就绪 · 演示</strong>
                    <p>
                      {application.party.occupied + 1}/
                      {application.party.capacity} 人 ·{" "}
                      {application.party.payment === "separate"
                        ? "各自下单、各自支付，一起到店吃。"
                        : "一人代付需要另行确认餐单、总价与付款人。"}
                    </p>
                    <p>
                      正式流程下一步：共同确定公开门店 → 各自选餐 → 各自确认 →
                      官方支付。
                    </p>
                  </div>
                </div>
                <div className="buddy-actions">
                  <button
                    className="outline-button"
                    disabled={saved.includes(application.party.id)}
                    onClick={() => setSaved([...saved, application.party.id])}
                  >
                    {saved.includes(application.party.id)
                      ? "已收藏演示搭子"
                      : "收藏演示搭子"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => decide("withdraw")}
                  >
                    退出演示饭局
                  </button>
                  <button className="text-button" onClick={onReturn}>
                    回到我的朋友餐桌 <ArrowRight size={15} />
                  </button>
                </div>
                <p className="setting-hint">
                  收藏只用于本次预览；这里的虚构成员不会加入你的真实餐单。
                </p>
              </>
            )}
          </section>
        )}
      </div>
      <div className="buddy-next">
        <strong>从相遇，到下一次约饭</strong>
        <p>
          正式版将支持双向申请、房间内沟通、互相添加饭搭子，以及退出、拉黑和举报。公开展示商圈与用餐偏好；确定饭局后再分享约定的门店。
        </p>
      </div>
    </section>
  );
}
