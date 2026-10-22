import type { MainChoice, Member, PaymentPolicy } from "./types.ts";

export const MAIN_CHOICES: MainChoice[] = ["chicken", "beef", "fish"];
export const MEMBER_COLORS = [
  "tomato",
  "orange",
  "blue",
  "green",
  "purple",
  "pink",
];

export function validateMembers(members: Member[], minimum = 2): void {
  if (!Array.isArray(members) || members.length < minimum || members.length > 6)
    throw new Error(`每桌支持 ${minimum}—6 人`);
  const ids = new Set<string>();
  for (const member of members) {
    if (
      !member ||
      typeof member.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(member.id) ||
      ids.has(member.id) ||
      typeof member.name !== "string" ||
      !member.name.trim() ||
      member.name.trim().length > 12 ||
      !MEMBER_COLORS.includes(member.color)
    )
      throw new Error("成员昵称需要 1—12 个字符，ID 不可重复，颜色需有效");
    ids.add(member.id);
    const p = member.preferences;
    if (
      !p ||
      !Number.isSafeInteger(p.budgetCents) ||
      p.budgetCents < 100 ||
      p.budgetCents > 100000
    )
      throw new Error("预算需要在 1—1000 元之间，精确到分");
    if (
      !MAIN_CHOICES.includes(p.main) ||
      !["none", "cola", "coffee"].includes(p.drink) ||
      !["must", "nice", "no"].includes(p.fries) ||
      typeof p.acceptsSharing !== "boolean"
    )
      throw new Error("偏好格式不正确");
    const exclusions = p.excludedMains ?? [];
    if (
      !Array.isArray(exclusions) ||
      exclusions.length > 2 ||
      new Set(exclusions).size !== exclusions.length ||
      exclusions.some((x) => !MAIN_CHOICES.includes(x)) ||
      exclusions.includes(p.main)
    )
      throw new Error("排除项与主餐选择冲突，至少保留一种可选主餐");
  }
}

export function validatePayment(
  payment: PaymentPolicy,
  members: Member[],
): void {
  if (payment.mode === "split") return;
  if (
    payment.mode !== "treat" ||
    !members.some((m) => m.id === payment.payerId) ||
    !Number.isSafeInteger(payment.totalBudgetCents) ||
    payment.totalBudgetCents < 100 ||
    payment.totalBudgetCents > 600000
  )
    throw new Error("请选择本桌请客人，并填写 1—6000 元的整桌预算");
}

/** Keep existing seats' preferences; new seats start with editable defaults. */
export function makeRoster(names: string[], previous: Member[] = []): Member[] {
  const members = names.map((name, i): Member => ({
    id: previous[i]?.id ?? `seat-${i + 1}`,
    name: name.trim(),
    color: MEMBER_COLORS[i],
    preferences: structuredClone(
      previous[i]?.preferences ?? {
        budgetCents: 5000,
        main: "chicken",
        drink: "cola",
        fries: "nice",
        acceptsSharing: true,
      },
    ),
  }));
  validateMembers(members);
  if (new Set(members.map((m) => m.name)).size !== members.length)
    throw new Error("同一桌请使用不同昵称，方便认领餐品");
  return members;
}
