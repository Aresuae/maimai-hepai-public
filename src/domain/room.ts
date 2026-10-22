import type {
  Member,
  Plan,
  Preferences,
  RoomState,
  PaymentPolicy,
} from "./types.ts";
import { validateMembers, validatePayment } from "./members.ts";

export function createDemoRoom(members: Member[]): RoomState {
  validateMembers(members);
  return {
    members: structuredClone(members),
    revision: 1,
    proposalVersion: 0,
    phase: "collecting",
    plans: [],
    selectedPlanId: null,
    confirmations: {},
    payment: { mode: "split" },
    vote: { round: 0, phase: "idle", ballots: {} },
  };
}

export function updatePreference(
  room: RoomState,
  memberId: string,
  patch: Partial<Preferences>,
): RoomState {
  if (!room.members.some((m) => m.id === memberId))
    throw new Error("成员不存在");
  const members = room.members.map((m) =>
    m.id === memberId
      ? { ...m, preferences: { ...m.preferences, ...patch } }
      : m,
  );
  validateMembers(members);
  return invalidate({ ...room, members });
}

function invalidate(room: RoomState): RoomState {
  return {
    ...room,
    revision: room.revision + 1,
    phase: "collecting",
    plans: [],
    selectedPlanId: null,
    confirmations: {},
    vote: { round: room.vote.round + 1, phase: "idle", ballots: {} },
  };
}

export function updatePayment(
  room: RoomState,
  payment: PaymentPolicy,
): RoomState {
  validatePayment(payment, room.members);
  return invalidate({ ...room, payment: { ...payment } });
}

export function replaceRoster(room: RoomState, members: Member[], minimum = 2): RoomState {
  validateMembers(members, minimum);
  // Loading another group never carries over anyone's promise to pay.
  return invalidate({
    ...room,
    members: structuredClone(members),
    payment: { mode: "split" },
  });
}

export function proposePlans(room: RoomState, plans: Plan[]): RoomState {
  if (!plans.length || plans.some((p) => p.roomRevision !== room.revision))
    throw new Error("方案已过时，请重新生成");
  return {
    ...room,
    plans,
    selectedPlanId: plans[0].id,
    proposalVersion: room.proposalVersion + 1,
    phase: "reviewing",
    confirmations: {},
    vote: { round: room.vote.round + 1, phase: "idle", ballots: {} },
  };
}

export function selectPlan(
  room: RoomState,
  planId: string,
  now = Date.now(),
): RoomState {
  if (room.vote.phase === "open" || room.vote.phase === "closed")
    throw new Error("请先完成投票并采用结果");
  const plan = room.plans.find((p) => p.id === planId);
  if (
    !plan ||
    plan.roomRevision !== room.revision ||
    plan.quote.expiresAt <= now
  )
    throw new Error("方案已过期，请重新生成");
  if (room.selectedPlanId === planId) return room;
  return {
    ...room,
    selectedPlanId: planId,
    proposalVersion: room.proposalVersion + 1,
    phase: "reviewing",
    confirmations: {},
    vote: { round: room.vote.round, phase: "idle", ballots: {} },
  };
}

export function confirmPlan(
  room: RoomState,
  memberId: string,
  expectedVersion: number,
  now = Date.now(),
): RoomState {
  if (room.vote.phase === "open" || room.vote.phase === "closed")
    throw new Error("投票不代替确认，请先完成投票并采用结果");
  if (!room.members.some((m) => m.id === memberId))
    throw new Error("成员不存在");
  const plan = room.plans.find((p) => p.id === room.selectedPlanId);
  if (
    !plan ||
    plan.roomRevision !== room.revision ||
    expectedVersion !== room.proposalVersion
  )
    throw new Error("餐单已经变更，请查看最新版本后确认");
  if (plan.quote.expiresAt <= now)
    throw new Error("演示报价已过期，请重新生成方案");
  const confirmations = { ...room.confirmations, [memberId]: expectedVersion };
  const complete = room.members.every(
    (m) => confirmations[m.id] === expectedVersion,
  );
  return {
    ...room,
    confirmations,
    phase: complete ? "confirmed" : "reviewing",
  };
}

export function revokeConfirmation(
  room: RoomState,
  memberId: string,
): RoomState {
  if (!room.members.some((m) => m.id === memberId))
    throw new Error("成员不存在");
  const confirmations = { ...room.confirmations };
  delete confirmations[memberId];
  return {
    ...room,
    confirmations,
    phase: room.selectedPlanId ? "reviewing" : "collecting",
  };
}
