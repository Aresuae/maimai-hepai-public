export function formatMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** Integer cents, largest-remainder allocation; stable IDs break ties. */
export function allocateCents(
  amount: number,
  weights: { id: string; weight: number }[],
): Record<string, number> {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000)
    throw new Error("金额必须是有效整数分");
  if (
    !weights.length ||
    new Set(weights.map((w) => w.id)).size !== weights.length
  )
    throw new Error("分摊成员不可为空或重复");
  if (
    weights.some(
      (w) =>
        !w.id ||
        !Number.isSafeInteger(w.weight) ||
        w.weight <= 0 ||
        w.weight > 1_000_000,
    )
  )
    throw new Error("分摊权重无效");
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (!Number.isSafeInteger(totalWeight)) throw new Error("分摊权重过大");
  const parts = weights.map((w) => ({
    id: w.id,
    value: Math.floor((amount * w.weight) / totalWeight),
    remainder: (amount * w.weight) % totalWeight,
  }));
  let remaining = amount - parts.reduce((sum, p) => sum + p.value, 0);
  parts.sort(
    (a, b) =>
      b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const part of parts) if (remaining-- > 0) part.value++;
  return Object.fromEntries(parts.map((p) => [p.id, p.value]));
}
