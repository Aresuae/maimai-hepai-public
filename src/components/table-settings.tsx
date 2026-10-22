"use client";

import { useEffect, useState } from "react";
import { Bookmark, Plus, Users, Wallet } from "lucide-react";
import type { Member, PaymentPolicy, RoomState } from "../domain/types";
import { makeRoster } from "../domain/members";
import {
  BUDDY_STORAGE_KEY,
  makeBuddyGroup,
  parseBuddyGroups,
  serializeBuddyGroups,
  type BuddyGroup,
} from "../domain/buddies";

interface Props {
  room: RoomState;
  onRoster: (members: Member[]) => void;
  onPayment: (payment: PaymentPolicy) => void;
  onNotice: (message: string) => void;
}

export function TableSettings({ room, onRoster, onPayment, onNotice }: Props) {
  const [names, setNames] = useState(room.members.map((m) => m.name));
  const [groupName, setGroupName] = useState("");
  const [groups, setGroups] = useState<BuddyGroup[]>([]);
  const [ready, setReady] = useState(false);
  const [budget, setBudget] = useState(
    String(
      room.members.reduce((sum, m) => sum + m.preferences.budgetCents, 0) / 100,
    ),
  );
  useEffect(() => {
    setNames(room.members.map((m) => m.name));
  }, [room.members]);
  useEffect(() => {
    if (room.payment.mode === "treat")
      setBudget(String(room.payment.totalBudgetCents / 100));
  }, [room.payment]);
  useEffect(() => {
    try {
      setGroups(parseBuddyGroups(localStorage.getItem(BUDDY_STORAGE_KEY)));
    } catch {
      onNotice("未能读取本地饭搭子记录；可继续体验，本次不会自动覆盖旧记录。");
    }
    setReady(true);
    // Read once; state changes are persisted only through an explicit save/delete action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function saveGroups(next: BuddyGroup[]) {
    localStorage.setItem(BUDDY_STORAGE_KEY, serializeBuddyGroups(next));
    setGroups(next);
  }
  function save() {
    try {
      if (groups.length >= 8)
        throw new Error("最多保存 8 组饭搭子，可先删除不用的分组");
      const group = makeBuddyGroup(
        crypto.randomUUID(),
        groupName,
        room.members,
      );
      if (groups.some((g) => g.name === group.name))
        throw new Error("已有同名分组，请换一个名字");
      saveGroups([...groups, group]);
      setGroupName("");
      onNotice(`已保存「${group.name}」及当前偏好到这个浏览器。`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "浏览器未允许保存");
    }
  }
  return (
    <details className="table-settings" open>
      <summary>
        <span>
          <Users size={17} /> 开一桌你们的合拍局
        </span>
        <small>{room.members.length} 人 · 人数、请客与饭搭子</small>
      </summary>
      <div className="settings-grid">
        <section className="setting-section">
          <h3>
            <Users size={16} /> 今天几位？
          </h3>
          <p className="setting-hint">人数由你选，首版支持 2—6 人。</p>
          <div className="count-picker" role="group" aria-label="选择合拍人数">
            {[2, 3, 4, 5, 6].map((count) => (
              <button
                key={count}
                aria-pressed={names.length === count}
                className={names.length === count ? "selected" : ""}
                onClick={() =>
                  setNames(
                    Array.from(
                      { length: count },
                      (_, i) => names[i] ?? `饭搭子${i + 1}`,
                    ),
                  )
                }
              >
                {count} 人
              </button>
            ))}
          </div>
          <div className="name-fields">
            {names.map((name, i) => (
              <label key={i}>
                <span>{i === 0 ? "发起人" : `饭搭子 ${i + 1}`}</span>
                <input
                  aria-label={`成员 ${i + 1} 昵称`}
                  value={name}
                  maxLength={12}
                  onChange={(e) =>
                    setNames(
                      names.map((n, j) => (j === i ? e.target.value : n)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            className="outline-button"
            onClick={() => {
              try {
                onRoster(makeRoster(names, room.members));
              } catch (error) {
                onNotice((error as Error).message);
              }
            }}
          >
            应用人数与昵称
          </button>
          <p className="setting-hint">
            应用后重新选餐、投票和确认，请客设置恢复为各付各的。
          </p>
        </section>
        <section className="setting-section">
          <h3>
            <Wallet size={16} /> 这一顿，怎么付？
          </h3>
          <div className="segmented payment-toggle">
            <button
              aria-pressed={room.payment.mode === "split"}
              className={room.payment.mode === "split" ? "selected" : ""}
              onClick={() => {
                if (room.payment.mode !== "split") onPayment({ mode: "split" });
              }}
            >
              各付各的
            </button>
            <button
              aria-pressed={room.payment.mode === "treat"}
              className={room.payment.mode === "treat" ? "selected" : ""}
              onClick={() => {
                if (room.payment.mode !== "treat")
                  onPayment({
                    mode: "treat",
                    payerId: room.members[0].id,
                    totalBudgetCents: room.members.reduce(
                      (n, m) => n + m.preferences.budgetCents,
                      0,
                    ),
                  });
              }}
            >
              我请客
            </button>
          </div>
          {room.payment.mode === "treat" ? (
            <>
              <label className="setting-field">
                谁来请客？
                <select
                  aria-label="请客人"
                  value={room.payment.payerId}
                  onChange={(e) => {
                    if (room.payment.mode === "treat")
                      onPayment({ ...room.payment, payerId: e.target.value });
                  }}
                >
                  {room.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-field">
                整桌预算（元）
                <input
                  aria-label="整桌预算（元）"
                  type="number"
                  min="1"
                  max="6000"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
              <button
                className="outline-button"
                onClick={() => {
                  if (room.payment.mode === "treat")
                    onPayment({
                      ...room.payment,
                      totalBudgetCents: Math.round(Number(budget) * 100),
                    });
                }}
              >
                应用请客预算
              </button>
              <p className="setting-hint">
                以已应用的整桌预算为上限。个人预算暂不参与筛选，口味与必选项保留。请客人也需最终确认。
              </p>
            </>
          ) : (
            <p className="setting-hint">
              各自的餐品自己承担；共享小食只在参与者之间均分。不会突破任何人的预算。
            </p>
          )}
        </section>
        <section className="setting-section">
          <h3>
            <Bookmark size={16} /> 固定饭搭子
          </h3>
          <p className="setting-hint">
            保存已应用的成员和偏好，下次一键开桌。仅保存在当前浏览器。
          </p>
          <div className="buddy-save">
            <input
              aria-label="饭搭子分组名称"
              placeholder="例如：周三午饭小队"
              maxLength={24}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="保存固定饭搭子"
              disabled={!ready || !groupName.trim()}
              onClick={save}
            >
              <Plus size={19} />
            </button>
          </div>
          <div className="buddy-list">
            {groups.length ? (
              groups.map((g) => (
                <div className="buddy-item" key={g.id}>
                  <div>
                    <strong>{g.name}</strong>
                    <small>
                      {g.members.length} 人 ·{" "}
                      {g.members.map((m) => m.name).join("、")}
                    </small>
                  </div>
                  <button
                    className="text-button red"
                    onClick={() => {
                      onRoster(g.members);
                      onNotice(
                        `已载入「${g.name}」，请每位成员检查偏好后重新确认。`,
                      );
                    }}
                  >
                    载入
                  </button>
                  <button
                    className="text-button"
                    aria-label={`删除饭搭子分组 ${g.name}`}
                    onClick={() => {
                      try {
                        saveGroups(groups.filter((x) => x.id !== g.id));
                        onNotice(`已删除「${g.name}」的本地记录。`);
                      } catch {
                        onNotice("删除失败，浏览器未允许写入本地存储。");
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ))
            ) : (
              <p className="buddy-empty">
                还没有固定饭搭子。把今天这一桌存下来吧。
              </p>
            )}
          </div>
        </section>
      </div>
    </details>
  );
}
