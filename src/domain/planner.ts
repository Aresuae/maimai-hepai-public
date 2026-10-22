import type {
  Allocation,
  CartLine,
  Member,
  MenuItem,
  Plan,
  PaymentPolicy,
} from "./types.ts";
import { allocateCents, formatMoney } from "./money.ts";
import { validateMembers, validatePayment } from "./members.ts";

export function allocateCart(
  lines: CartLine[],
  members: Member[],
  menu: MenuItem[],
): Allocation[] {
  const allocations: Allocation[] = members.map((m) => ({
    memberId: m.id,
    totalCents: 0,
    payableCents: 0,
    items: [],
    notes: [],
  }));
  for (const line of lines) {
    const item = menu.find((i) => i.id === line.itemId);
    if (
      !item ||
      !Number.isSafeInteger(item.priceCents) ||
      item.priceCents < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 20
    )
      throw new Error("餐品或数量无效");
    if (line.memberIds.some((id) => !members.some((m) => m.id === id)))
      throw new Error("餐品包含未知成员");
    const amounts = allocateCents(
      item.priceCents * line.quantity,
      line.memberIds.map((id) => ({ id, weight: 1 })),
    );
    for (const allocation of allocations) {
      if (!Object.hasOwn(amounts, allocation.memberId)) continue;
      const amountCents = amounts[allocation.memberId];
      allocation.totalCents += amountCents;
      allocation.payableCents += amountCents;
      allocation.items.push({
        name: item.name,
        amountCents,
        shared: line.memberIds.length > 1,
      });
    }
  }
  return allocations;
}

/** Demo-only bounded strategies; no official discounts, bundles, or global optimality claims. */
export function buildDemoPlans(
  members: Member[],
  menu: MenuItem[],
  roomRevision: number,
  now = Date.now(),
  payment: PaymentPolicy = { mode: "split" },
): { plans: Plan[]; conflicts: string[] } {
  validateMembers(members);
  validatePayment(payment, members);
  if (new Set(menu.map((i) => i.id)).size !== menu.length)
    throw new Error("菜单编码重复");
  const base: CartLine[] = [];
  const conflicts: string[] = [];
  const fries = menu.find((i) => i.kind === "side" && !i.shared);
  for (const member of members) {
    const p = member.preferences;
    const main = menu.find((i) => i.main === p.main);
    const drink =
      p.drink === "none" ? undefined : menu.find((i) => i.drink === p.drink);
    if (
      !main ||
      (p.drink !== "none" && !drink) ||
      (p.fries === "must" && !fries)
    ) {
      conflicts.push(`${member.name}的必选餐品在当前演示菜单中不可用。`);
      continue;
    }
    const chosen = [
      main,
      ...(drink ? [drink] : []),
      ...(p.fries === "must" && fries ? [fries] : []),
    ];
    const cost = chosen.reduce((sum, item) => sum + item.priceCents, 0);
    if (payment.mode === "split" && cost > p.budgetCents)
      conflicts.push(
        `${member.name}的必选餐品需要 ${formatMoney(cost)}，超出预算 ${formatMoney(cost - p.budgetCents)}。请由本人调整预算或必选项。`,
      );
    for (const item of chosen)
      base.push({ itemId: item.id, quantity: 1, memberIds: [member.id] });
  }
  if (conflicts.length) return { plans: [], conflicts };

  const totals = Object.fromEntries(
    allocateCart(base, members, menu).map((a) => [a.memberId, a.totalCents]),
  );
  const baseTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  if (payment.mode === "treat" && baseTotal > payment.totalBudgetCents)
    return {
      plans: [],
      conflicts: [
        `整桌必选餐品需要 ${formatMoney(baseTotal)}，超出请客预算 ${formatMoney(baseTotal - payment.totalBudgetCents)}。请调整整桌预算或由成员修改必选项。`,
      ],
    };
  const wish = structuredClone(base);
  if (fries)
    for (const m of members) {
      if (
        m.preferences.fries === "nice" &&
        (payment.mode === "treat" ||
          totals[m.id] + fries.priceCents <= m.preferences.budgetCents)
      )
        wish.push({ itemId: fries.id, quantity: 1, memberIds: [m.id] });
    }
  const shared = structuredClone(base);
  const sharingItem = menu.find((i) => i.kind === "side" && i.shared);
  let sharingMembers = members.filter(
    (m) => m.preferences.fries === "nice" && m.preferences.acceptsSharing,
  );
  // Removing an unaffordable share can increase the others' share, so recheck until stable.
  while (sharingItem && sharingMembers.length > 1) {
    const amounts = allocateCents(
      sharingItem.priceCents,
      sharingMembers.map((m) => ({ id: m.id, weight: 1 })),
    );
    const filtered = sharingMembers.filter(
      (m) =>
        payment.mode === "treat" ||
        totals[m.id] + amounts[m.id] <= m.preferences.budgetCents,
    );
    if (filtered.length === sharingMembers.length) break;
    sharingMembers = filtered;
  }
  const activeSharers =
    sharingItem && sharingMembers.length > 1
      ? sharingMembers.map((m) => m.id)
      : [];
  if (sharingItem && activeSharers.length)
    shared.push({
      itemId: sharingItem.id,
      quantity: 1,
      memberIds: activeSharers,
    });
  if (fries)
    for (const m of members) {
      if (
        m.preferences.fries === "nice" &&
        !activeSharers.includes(m.id) &&
        (payment.mode === "treat" ||
          totals[m.id] + fries.priceCents <= m.preferences.budgetCents)
      )
        shared.push({ itemId: fries.id, quantity: 1, memberIds: [m.id] });
    }
  const strategies = [
    {
      id: "simple",
      title: "预算优先",
      description: "保留每个人的必选项",
      lines: base,
    },
    {
      id: "wish",
      title: "心愿优先",
      description: "预算内，照顾更多小心愿",
      lines: wish,
    },
    {
      id: "sharing",
      title: "一起分享",
      description: "愿意分享的人，共享一份薯条",
      lines: shared,
    },
  ];
  const signatures = new Set<string>();
  const plans: Plan[] = [];
  for (const strategy of strategies) {
    const signature = strategy.lines
      .map(
        (l) => `${l.itemId}:${l.quantity}:${[...l.memberIds].sort().join(",")}`,
      )
      .sort()
      .join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const allocations = allocateCart(strategy.lines, members, menu);
    for (const allocation of allocations) {
      const m = members.find((member) => member.id === allocation.memberId)!;
      if (
        m.preferences.fries === "nice" &&
        !strategy.lines.some(
          (l) =>
            l.memberIds.includes(m.id) &&
            menu.find((i) => i.id === l.itemId)?.kind === "side",
        )
      )
        allocation.notes.push("这套方案没有安排可选薯条");
    }
    const totalCents = allocations.reduce((sum, a) => sum + a.totalCents, 0);
    if (payment.mode === "treat" && totalCents > payment.totalBudgetCents)
      continue;
    if (
      payment.mode === "split" &&
      allocations.some(
        (a) =>
          a.totalCents >
          members.find((m) => m.id === a.memberId)!.preferences.budgetCents,
      )
    )
      continue;
    if (payment.mode === "treat") {
      for (const allocation of allocations)
        allocation.payableCents =
          allocation.memberId === payment.payerId ? totalCents : 0;
    }
    plans.push({
      ...strategy,
      roomRevision,
      payment: { ...payment },
      allocations,
      quote: {
        source: "demo",
        totalCents: allocations.reduce((sum, a) => sum + a.totalCents, 0),
        quotedAt: now,
        expiresAt: now + 5 * 60_000,
      },
    });
  }
  return { plans, conflicts };
}
