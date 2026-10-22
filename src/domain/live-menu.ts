import type { Member, PaymentPolicy } from "./types.ts";
import { allocateCents } from "./money.ts";

export interface LiveCartLine {
  id: string;
  memberId: string;
  productCode: string;
  name: string;
  couponRef?: string;
  configurationKey?: string;
  parts: string[];
}
export interface LiveQuote {
  source: "live";
  storeCode: string;
  quotedAt: number;
  quote: {
    price: number;
    originalPrice?: number;
    discount?: number;
    productList: {
      productCode: string;
      productName: string;
      quantity: number;
      subtotal: number;
    }[];
  };
}

/** Per-code subtotals are shared across identical items; whole-cart adjustments are proportional.
 * This is an app allocation, never a claimed official per-person transaction price. */
export function allocateLiveQuote(
  lines: LiveCartLine[],
  result: LiveQuote,
  members: Member[],
  payment: PaymentPolicy,
) {
  if (
    !lines.length ||
    new Set(lines.map((l) => l.id)).size !== lines.length ||
    lines.some((l) => !members.some((m) => m.id === l.memberId))
  )
    throw new Error("餐单成员已变化，请重新选餐。");
  const totals = new Map<string, { quantity: number; subtotal: number }>();
  for (const p of result.quote.productList) {
    if (
      !Number.isSafeInteger(p.subtotal) ||
      p.subtotal < 0 ||
      !Number.isSafeInteger(p.quantity) ||
      p.quantity < 1
    )
      throw new Error("官方明细格式不完整。");
    const old = totals.get(p.productCode) ?? { quantity: 0, subtotal: 0 };
    totals.set(p.productCode, {
      quantity: old.quantity + p.quantity,
      subtotal: old.subtotal + p.subtotal,
    });
  }
  if (totals.size !== new Set(lines.map((l) => l.productCode)).size)
    throw new Error("报价商品与餐单不一致。");
  const memberWeights = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const [code, total] of totals) {
    const matching = lines.filter((l) => l.productCode === code);
    if (matching.length !== total.quantity)
      throw new Error("报价数量与餐单不一致。");
    const shares = allocateCents(
      total.subtotal,
      matching.map((l) => ({ id: l.id, weight: 1 })),
    );
    for (const line of matching)
      memberWeights[line.memberId] += shares[line.id];
  }
  const participants = members.filter((m) =>
    lines.some((l) => l.memberId === m.id),
  );
  const paidWeights = participants.filter((m) => memberWeights[m.id] > 0);
  const apportioned = allocateCents(
    result.quote.price,
    (paidWeights.length ? paidWeights : participants).map((m) => ({
      id: m.id,
      weight: memberWeights[m.id] || 1,
    })),
  );
  if (
    payment.mode === "treat" &&
    !members.some((m) => m.id === payment.payerId)
  )
    throw new Error("请客人已变化。");
  const allocations = members.map((m) => ({
    memberId: m.id,
    mealCents: apportioned[m.id] ?? 0,
    payableCents:
      payment.mode === "treat"
        ? payment.payerId === m.id
          ? result.quote.price
          : 0
        : (apportioned[m.id] ?? 0),
  }));
  const conflicts =
    payment.mode === "treat"
      ? result.quote.price > payment.totalBudgetCents
        ? ["官方总额超过请客预算，请调整餐单或预算后重新核价。"]
        : []
      : members
          .filter((m) => (apportioned[m.id] ?? 0) > m.preferences.budgetCents)
          .map(
            (m) =>
              `${m.name}的分摊金额超过个人预算，请调整餐单或预算后重新核价。`,
          );
  return { allocations, conflicts };
}
