"use client";
import { Vote } from "lucide-react";
import { adoptVote, castVote, startVote, voteSummary } from "../domain/voting";
import type { RoomState } from "../domain/types";

export function VotePanel({
  room,
  activeId,
  expired,
  onChange,
  onNotice,
}: {
  room: RoomState;
  activeId: string;
  expired: boolean;
  onChange: (room: RoomState) => void;
  onNotice: (text: string) => void;
}) {
  const summary = voteSummary(room);
  const isHost = activeId === room.members[0].id;
  function act(action: () => RoomState, message: string) {
    try {
      onChange(action());
      onNotice(message);
    } catch (error) {
      onNotice((error as Error).message);
    }
  }
  return (
    <section className="vote-panel" aria-label="匿名投票">
      <div className="vote-heading">
        <h4>
          <Vote size={17} /> 先投票，再揭晓
        </h4>
        {room.vote.phase === "idle" && (
          <button
            className="text-button red"
            disabled={expired || room.plans.length < 2 || !isHost}
            onClick={() =>
              act(
                () => startVote(room),
                "投票已开启，原确认已清空；切换角色模拟每人投一票。",
              )
            }
          >
            开启匿名投票
          </button>
        )}
        {room.vote.phase !== "idle" && (
          <span>
            {summary.submitted} / {room.members.length} 人已投
          </span>
        )}
      </div>
      {room.vote.phase === "idle" && (
        <p>
          {room.plans.length < 2
            ? "本次只有一套可行方案，直接确认即可。"
            : "发起人可开启投票。全员投完才公布票数，平票时由发起人从并列方案中选定。"}
        </p>
      )}
      {room.vote.phase === "open" && (
        <>
          <p>
            现在是{room.members.find((m) => m.id === activeId)!.name}
            的选票。揭晓前可改票，只计最后一次。
          </p>
          <div className="ballot-options">
            {room.plans.map((p) => (
              <button
                className={
                  room.vote.ballots[activeId] === p.id ? "selected" : ""
                }
                aria-pressed={room.vote.ballots[activeId] === p.id}
                key={p.id}
                disabled={expired}
                onClick={() =>
                  act(
                    () => castVote(room, activeId, p.id, room.vote.round),
                    "选票已记录；全员完成后揭晓汇总结果。",
                  )
                }
              >
                {p.title}
                {room.vote.ballots[activeId] === p.id ? " · 我的票" : ""}
              </button>
            ))}
          </div>
        </>
      )}
      {(room.vote.phase === "closed" || room.vote.phase === "resolved") && (
        <>
          <div className="vote-results">
            {summary.counts.map((c) => (
              <div key={c.planId}>
                <span>{room.plans.find((p) => p.id === c.planId)!.title}</span>
                <meter
                  min={0}
                  max={room.members.length}
                  value={c.count}
                  aria-label={`${c.planId} 票数`}
                />
                <strong>{c.count} 票</strong>
              </div>
            ))}
          </div>
          {room.vote.phase === "closed" ? (
            <>
              <p>
                {summary.winnerIds.length > 1
                  ? "出现平票，请发起人从并列方案中选一个，再由全员确认。"
                  : "结果已揭晓，请发起人采用获选方案，再由全员确认。"}
              </p>
              <div className="ballot-options">
                {summary.winnerIds.map((id) => (
                  <button
                    key={id}
                    disabled={expired || !isHost}
                    onClick={() =>
                      act(
                        () => adoptVote(room, id),
                        "已采用投票结果，请逐人确认餐单与应付金额。",
                      )
                    }
                  >
                    采用{room.plans.find((p) => p.id === id)!.title}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="vote-adopted">
              已采用投票结果。投票只代表倾向，仍需每个人确认餐单。
            </p>
          )}
        </>
      )}
      <small className="vote-disclaimer">
        单机匿名演示：页面仅公开汇总票数；角色切换可查看各角色自己的选票。真实身份隔离将随多人服务端实现。
      </small>
    </section>
  );
}
