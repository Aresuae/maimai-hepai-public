"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Clock, MapPin, Pencil, Plus, Users } from "lucide-react";
import { z } from "zod";
import {
  BUDDY_TAGS,
  MEAL_WINDOWS,
  buddyStartAt,
  type BuddyPayment,
  type MealWindow,
} from "../domain/buddy-matching";
import {
  makePublishedBuddy,
  parseBudgetYuan,
  publishedBuddyStatus,
  shanghaiDate,
  type PublishedBuddyParty,
} from "../domain/buddy-publishing";
import { formatMoney } from "../domain/money";

type Props = {
  parties: PublishedBuddyParty[];
  editorId: string | null;
  ready: boolean;
  city: string;
  area: string;
  now: number;
  onEditor: (id: string | null) => void;
  onSave: (party: PublishedBuddyParty, previous?: PublishedBuddyParty) => Promise<void>;
  onClose: (party: PublishedBuddyParty, closed: boolean) => void;
  onBrowse: (party: PublishedBuddyParty) => void;
};
export function BuddyPublisher({
  parties,
  editorId,
  ready,
  city,
  area,
  now,
  onEditor,
  onSave,
  onClose,
  onBrowse,
}: Props) {
  const [host, setHost] = useState("我");
  const [title, setTitle] = useState("");
  const [draftCity, setDraftCity] = useState(city);
  const [draftArea, setDraftArea] = useState(area);
  const [date, setDate] = useState("");
  const [window, setWindow] = useState<MealWindow>("lunch");
  const [capacity, setCapacity] = useState(2);
  const [low, setLow] = useState("25");
  const [high, setHigh] = useState("50");
  const [payment, setPayment] = useState<BuddyPayment>("separate");
  const [tags, setTags] = useState<string[]>(["轻松聊天"]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<PublishedBuddyParty | undefined>();
  useEffect(() => {
    if (!editorId) return;
    const previous = parties.find((p) => p.id === editorId);
    const current = Date.now();
    const today = shanghaiDate(current);
    setOriginal(previous);
    setHost(previous?.host ?? "我");
    setTitle(previous?.title ?? "");
    setDraftCity(previous?.city ?? city);
    setDraftArea(previous?.area ?? area);
    setDate(
      previous?.mealDate ??
        (buddyStartAt(today, "lunch") > current
          ? today
          : shanghaiDate(current + 86400000)),
    );
    setWindow(previous?.window ?? "lunch");
    setCapacity(previous?.capacity ?? 2);
    setLow(String((previous?.minBudgetCents ?? 2500) / 100));
    setHigh(String((previous?.maxBudgetCents ?? 5000) / 100));
    setPayment(previous?.payment ?? "separate");
    setTags(previous?.tags ?? ["轻松聊天"]);
    setError("");
    // A draft must not be overwritten when local records or discovery filters update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (!ready) throw new Error("本机发布记录尚未就绪，请稍后再试。");
      if (editorId !== "new" && !original)
        throw new Error("未找到要编辑的饭局，请重新打开。");
      const party = makePublishedBuddy(
        {
          host,
          title,
          city: draftCity,
          area: draftArea,
          mealDate: date,
          window,
          capacity,
          minBudgetCents: parseBudgetYuan(low),
          maxBudgetCents: parseBudgetYuan(high),
          payment,
          tags: tags as PublishedBuddyParty["tags"],
        },
        original?.id ?? "local-" + crypto.randomUUID(),
        Date.now(),
        original,
      );
      await onSave(party, original);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues[0].message
          : e instanceof Error
            ? e.message
            : "暂时无法保存，请重试。",
      );
    } finally { setSaving(false); }
  }
  return (
    <section className="buddy-publisher" aria-label="我的发布">
      <div className="live-section-heading">
        <h3>
          我的发布{" "}
          <span className="buddy-demo-label">{parties.length} 个本机饭局</span>
        </h3>
        <button
          className="text-button"
          disabled={!ready || editorId === "new"}
          onClick={() => onEditor("new")}
        >
          <Plus size={16} /> 再发起一局
        </button>
      </div>
      <p className="setting-hint">
        发布内容保存在这台电脑的 SQLite 数据库，程序重启后可继续管理。本机页面共用同一工作区，尚未对外公开或接收真实报名。
      </p>
      {editorId && (
        <form
          className="buddy-publish-form"
          aria-label={original ? "编辑找搭子饭局" : "发布找搭子饭局"}
          noValidate
          onSubmit={submit}
        >
          <span className="eyebrow">
            {original ? "EDIT YOUR TABLE" : "START A TABLE"}
          </span>
          <h3>{original ? "修改这次饭局" : "你来发起这一顿"}</h3>
          {original?.closed && <p className="setting-hint">这条饭局已取消招募。保存未来的日期或时段后，点击「重新招募」即可恢复。</p>}
          <div className="buddy-fields">
            <label className="full-field">
              招募标题
              <input
                autoFocus
                aria-label="招募标题"
                value={title}
                placeholder="例如：今天午饭，找一位不赶时间的饭搭子"
                maxLength={40}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              发起人昵称
              <input
                aria-label="发起人昵称"
                value={host}
                maxLength={20}
                required
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label>
              城市
              <input
                aria-label="发布城市"
                value={draftCity}
                maxLength={30}
                required
                onChange={(e) => setDraftCity(e.target.value)}
              />
            </label>
            <label className="full-field">
              商圈或公共碰面区域
              <input
                aria-label="发布商圈"
                value={draftArea}
                maxLength={60}
                placeholder="例如：黄浦 · 人民广场商圈"
                required
                onChange={(e) => setDraftArea(e.target.value)}
              />
            </label>
            <label>
              用餐日期
              <input
                aria-label="用餐日期"
                type="date"
                value={date}
                min={shanghaiDate(now)}
                required
                onInput={(e) => setDate(e.currentTarget.value)}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              用餐时段
              <select
                aria-label="发布用餐时段"
                value={window}
                onChange={(e) => setWindow(e.target.value as MealWindow)}
              >
                {Object.entries(MEAL_WINDOWS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              总人数（含你自己）
              <select
                aria-label="发布饭局总人数"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} 人 · 再找 {n - 1} 位搭子
                  </option>
                ))}
              </select>
            </label>
            <label>
              下单方式
              <select
                aria-label="发布下单方式"
                value={payment}
                onChange={(e) => setPayment(e.target.value as BuddyPayment)}
              >
                <option value="separate">各自下单，一起吃</option>
                <option value="host">协商一人代付，再分账</option>
              </select>
            </label>
            <label>
              建议人均预算下限（元）
              <input
                aria-label="发布预算下限"
                type="number"
                min={1}
                max={1000}
                step="0.01"
                value={low}
                onChange={(e) => setLow(e.target.value)}
              />
            </label>
            <label>
              建议人均预算上限（元）
              <input
                aria-label="发布预算上限"
                type="number"
                min={1}
                max={1000}
                step="0.01"
                value={high}
                onChange={(e) => setHigh(e.target.value)}
              />
            </label>
          </div>
          <p className="setting-hint">给饭局选几个标签</p>
          <div className="buddy-tags" role="group" aria-label="发布饭局标签">
            {BUDDY_TAGS.map((tag) => (
              <button
                type="button"
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
            发起人占 1
            个位置；到用餐开始时间停止招募。预算是约饭范围，付款仍须各自确认。
            {original?.closed ? "这条饭局已关闭，保存修改后仍保持关闭。" : ""}
          </p>
          {error && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
          <div className="buddy-actions">
            <button type="submit" className="primary-button" disabled={!ready || saving}>
              {saving ? "正在保存…" : original ? "保存修改" : "保存到本机数据库"}
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={saving}
              onClick={() => onEditor(null)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {!parties.length && !editorId && (
        <div className="live-empty">
          <p>
            你还没有发布饭局。写下想在哪儿、什么时候吃，给新搭子一个加入的入口。
          </p>
          <button
            className="primary-button"
            disabled={!ready}
            onClick={() => onEditor("new")}
          >
            <Plus size={16} /> 发布找搭子
          </button>
        </div>
      )}
      <div className="buddy-owned-list">
        {parties.map((party) => {
          const status = publishedBuddyStatus(party, now);
          return (
            <article
              key={party.id}
              className="buddy-card buddy-owned-card"
              aria-label={"我的饭局 " + party.title}
            >
              <div className="live-section-heading">
                <span className="buddy-demo-label">
                  {status === "open"
                    ? "招募中 · 仅本机"
                    : status === "closed"
                      ? "已取消招募"
                      : "已过期"}
                </span>
                <small>我发布的</small>
              </div>
              <h4>{party.title}</h4>
              <p>
                <MapPin size={14} />
                {party.city} · {party.area}
              </p>
              <p>
                <CalendarDays size={14} />
                {party.mealDate} · {MEAL_WINDOWS[party.window]}
              </p>
              <p>
                <Users size={14} />
                {party.capacity} 人局 · 我占 1 位 · 还可加入{" "}
                {party.capacity - 1} 人
              </p>
              <div className="buddy-price">
                {formatMoney(party.minBudgetCents)}—
                {formatMoney(party.maxBudgetCents)} / 人
                <small>
                  {" "}
                  · {party.payment === "separate" ? "各自下单" : "协商代付"}
                </small>
              </div>
              <div className="buddy-reasons">
                {party.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p>
                <Clock size={14} />
                {party.closed
                  ? buddyStartAt(party.mealDate, party.window) <= now
                    ? "招募已取消，记录保留。修改为未来时间后可重新招募。"
                    : "招募已取消，记录保留。需要时可重新招募。"
                  : status === "expired"
                    ? "用餐时间已过，仍可取消招募；继续招募请先修改时间。"
                    : "当前没有真实报名，等待正式多人功能接入。"}
              </p>
              <div className="buddy-actions">
                <button
                  className="outline-button"
                  disabled={!ready || saving}
                  onClick={() => onEditor(party.id)}
                >
                  <Pencil size={14} /> 编辑饭局
                </button>
                <button
                  className="outline-button"
                  disabled={!ready || saving}
                  onClick={() => party.closed && buddyStartAt(party.mealDate, party.window) <= now
                    ? onEditor(party.id) : onClose(party, !party.closed)}
                >
                  {party.closed ? buddyStartAt(party.mealDate, party.window) <= now ? "修改时间后重开" : "重新招募" : "取消招募"}
                </button>
                <button
                  className="text-button"
                  disabled={status !== "open"}
                  onClick={() => onBrowse(party)}
                >
                  在列表中查看
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
