import type { RoomState } from "./types.ts";
import { selectPlan } from "./room.ts";

function fresh(room: RoomState, now: number) {
  if (
    !room.plans.length ||
    room.plans.some(
      (p) => p.roomRevision !== room.revision || p.quote.expiresAt <= now,
    )
  )
    throw new Error("方案已过期，请重新生成后投票");
}

export function startVote(room: RoomState, now = Date.now()): RoomState {
  fresh(room, now);
  if (room.plans.length < 2) throw new Error("只有一套方案，直接逐人确认即可");
  return {
    ...room,
    phase: "reviewing",
    proposalVersion: room.proposalVersion + 1,
    confirmations: {},
    vote: { round: room.vote.round + 1, phase: "open", ballots: {} },
  };
}

export function castVote(
  room: RoomState,
  memberId: string,
  planId: string,
  round: number,
  now = Date.now(),
): RoomState {
  fresh(room, now);
  if (room.vote.phase !== "open" || round !== room.vote.round)
    throw new Error("本轮投票已结束或已经变更");
  if (
    !room.members.some((m) => m.id === memberId) ||
    !room.plans.some((p) => p.id === planId)
  )
    throw new Error("成员或候选方案不存在");
  const ballots = { ...room.vote.ballots, [memberId]: planId };
  const complete = room.members.every((m) => Object.hasOwn(ballots, m.id));
  return {
    ...room,
    vote: { ...room.vote, ballots, phase: complete ? "closed" : "open" },
  };
}

/** A public UI projection: never expose individual ballots or partial totals. */
export function voteSummary(room: RoomState) {
  const completed =
    room.vote.phase === "closed" || room.vote.phase === "resolved";
  const counts = completed
    ? room.plans.map((p) => ({
        planId: p.id,
        count: room.members.filter((m) => room.vote.ballots[m.id] === p.id)
          .length,
      }))
    : [];
  const max = Math.max(0, ...counts.map((c) => c.count));
  return {
    submitted: Object.keys(room.vote.ballots).length,
    counts,
    winnerIds: counts
      .filter((c) => c.count === max && max > 0)
      .map((c) => c.planId),
  };
}

export function adoptVote(
  room: RoomState,
  planId: string,
  now = Date.now(),
): RoomState {
  fresh(room, now);
  if (
    room.vote.phase !== "closed" ||
    !voteSummary(room).winnerIds.includes(planId)
  )
    throw new Error("只能采用本轮得票最多的方案；平票时由发起人选择");
  const selected = selectPlan(
    { ...room, vote: { ...room.vote, phase: "resolved" } },
    planId,
    now,
  );
  return { ...selected, vote: { ...room.vote, phase: "resolved" } };
}
