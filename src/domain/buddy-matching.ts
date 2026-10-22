export type MealWindow = "lunch" | "dinner" | "coffee";
export type BuddyPayment = "separate" | "host";
export const MEAL_WINDOWS: Record<MealWindow, string> = {
  lunch: "午餐 · 12:00—13:00",
  dinner: "晚餐 · 18:00—19:00",
  coffee: "下午茶 · 15:00—16:00",
};
export const BUDDY_TAGS = [
  "轻松聊天",
  "安静吃饭",
  "不赶时间",
  "汉堡",
  "薯条",
  "咖啡",
] as const;
export const MEAL_STARTS: Record<MealWindow, string> = {
  lunch: "12:00",
  dinner: "18:00",
  coffee: "15:00",
};
export function buddyStartAt(date: string, window: MealWindow) {
  return Date.parse(date + "T" + MEAL_STARTS[window] + ":00+08:00");
}
export interface BuddyParty {
  id: string;
  host: string;
  title: string;
  city: string;
  area: string;
  window: MealWindow;
  minBudgetCents: number;
  maxBudgetCents: number;
  capacity: number;
  occupied: number;
  tags: string[];
  payment: BuddyPayment;
  closed?: boolean;
  mealDate?: string;
}
export interface BuddySearch {
  city: string;
  area: string;
  window: MealWindow;
  budgetCents: number;
  capacity: number | null;
  tags: string[];
  payment: BuddyPayment;
  mealDate?: string;
}
const cityKey = (text: string) => text.trim().replace(/市$/, "");

/** Explicit preference matches, not an inferred social compatibility score. */
export function matchBuddyParties(
  parties: BuddyParty[],
  search: BuddySearch,
  hidden: string[] = [],
  now = Date.now(),
) {
  if (
    !cityKey(search.city) ||
    !Number.isSafeInteger(search.budgetCents) ||
    search.budgetCents < 100 ||
    search.budgetCents > 100000
  )
    return [];
  return parties
    .filter(
      (party) =>
        !hidden.includes(party.id) &&
        !party.closed &&
        (!party.mealDate || buddyStartAt(party.mealDate, party.window) > now) &&
        (!search.mealDate || party.mealDate === search.mealDate) &&
        party.occupied < party.capacity &&
        cityKey(party.city) === cityKey(search.city) &&
        (!search.area.trim() || party.area.includes(search.area.trim())) &&
        party.window === search.window &&
        party.payment === search.payment &&
        party.minBudgetCents <= search.budgetCents &&
        (!search.capacity || party.capacity === search.capacity),
    )
    .map((party) => {
      const sharedTags = party.tags.filter((tag) => search.tags.includes(tag));
      return {
        party,
        sharedTags,
        reasons: [
          "同城同时间段",
          "预算有交集",
          ...sharedTags.map((tag) => "都喜欢" + tag),
        ],
      };
    })
    .sort(
      (a, b) =>
        b.sharedTags.length - a.sharedTags.length ||
        a.party.id.localeCompare(b.party.id),
    );
}

export type BuddyApplicationState =
  "pending" | "accepted" | "declined" | "withdrawn";
export function transitionBuddyApplication(
  state: BuddyApplicationState,
  action: "accept" | "decline" | "withdraw",
): BuddyApplicationState {
  if (action === "withdraw" && (state === "pending" || state === "accepted"))
    return "withdrawn";
  if (state !== "pending") throw new Error("申请状态已变化，请重新查看。");
  return action === "accept" ? "accepted" : "declined";
}
