import { z } from "zod";
import { BUDDY_TAGS, buddyStartAt, type BuddyParty } from "./buddy-matching.ts";

export const PUBLISHED_BUDDIES_KEY = "maimai-published-buddies-v1";
export const MAX_PUBLISHED_BUDDIES = 20;
export function shanghaiDate(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
const DateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "请选择用餐日期")
  .refine((date) => {
    const timestamp = Date.parse(date + "T00:00:00+08:00");
    return Number.isFinite(timestamp) && shanghaiDate(timestamp) === date;
  }, "用餐日期不正确");
const fields = {
  host: z.string().trim().min(1, "请填写发起人昵称").max(20, "昵称最多 20 字"),
  title: z.string().trim().min(1, "请写一句招募标题").max(40, "标题最多 40 字"),
  city: z.string().trim().min(1, "请填写城市").max(30, "城市最多 30 字"),
  area: z
    .string()
    .trim()
    .min(1, "请填写商圈或公共碰面区域")
    .max(60, "商圈最多 60 字"),
  mealDate: DateText,
  window: z.enum(["lunch", "dinner", "coffee"]),
  capacity: z.number().int().min(2).max(6),
  minBudgetCents: z
    .number()
    .int()
    .min(100, "人均预算至少 1 元")
    .max(100000, "人均预算最多 1000 元"),
  maxBudgetCents: z
    .number()
    .int()
    .min(100, "人均预算至少 1 元")
    .max(100000, "人均预算最多 1000 元"),
  tags: z
    .array(z.enum(BUDDY_TAGS))
    .max(6)
    .transform((tags) => [...new Set(tags)]),
  payment: z.enum(["separate", "host"]),
};
const Draft = z
  .object(fields)
  .strict()
  .refine((p) => p.minBudgetCents <= p.maxBudgetCents, "预算下限不能高于上限");
export type BuddyPublishDraft = z.input<typeof Draft>;
const Published = z
  .object({
    ...fields,
    id: z.string().regex(/^local-[a-zA-Z0-9-]{1,80}$/),
    source: z.literal("local"),
    occupied: z.literal(1),
    closed: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (p) => p.minBudgetCents <= p.maxBudgetCents && p.updatedAt >= p.createdAt,
    "发布记录格式不正确",
  );
export type PublishedBuddyParty = z.output<typeof Published>;

export function parseBudgetYuan(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("预算请输入金额，最多两位小数。");
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 100 || cents > 100000)
    throw new Error("人均预算需要在 1—1000 元之间。");
  return cents;
}
export function makePublishedBuddy(
  raw: BuddyPublishDraft,
  id: string,
  now = Date.now(),
  previous?: PublishedBuddyParty,
): PublishedBuddyParty {
  const draft = Draft.parse(raw);
  if (buddyStartAt(draft.mealDate, draft.window) <= now)
    throw new Error("这个用餐时间已经开始，请选择未来的日期或时段。");
  if (previous && previous.id !== id)
    throw new Error("要编辑的饭局已变化，请重新打开。");
  return Published.parse({
    ...draft,
    id,
    source: "local",
    occupied: 1,
    closed: previous?.closed ?? false,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });
}
export function publishedBuddyStatus(party: BuddyParty, now = Date.now()) {
  if (party.closed) return "closed";
  if (party.mealDate && buddyStartAt(party.mealDate, party.window) <= now)
    return "expired";
  return "open";
}
export function setPublishedBuddyClosed(
  party: PublishedBuddyParty,
  closed: boolean,
  now = Date.now(),
) {
  if (!closed && buddyStartAt(party.mealDate, party.window) <= now)
    throw new Error("饭局已过期，请先修改日期或时段再重新招募。");
  return Published.parse({ ...party, closed, updatedAt: now });
}
const Stored = z
  .object({
    version: z.literal(1),
    parties: z.array(Published).max(MAX_PUBLISHED_BUDDIES),
  })
  .strict()
  .refine(
    (data) =>
      new Set(data.parties.map((p) => p.id)).size === data.parties.length,
    "发布记录包含重复饭局",
  );
export function parsePublishedBuddies(
  raw: string | null,
): PublishedBuddyParty[] {
  if (raw === null) return [];
  if (raw.length > 64000) throw new Error("本机发布记录过大，未加载。");
  return Stored.parse(JSON.parse(raw)).parties;
}
export function serializePublishedBuddies(parties: PublishedBuddyParty[]) {
  return JSON.stringify(Stored.parse({ version: 1, parties }));
}
