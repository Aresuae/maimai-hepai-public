import type { MainChoice, MenuItem, RoomState } from "./types.ts";
import { MAIN_CHOICES } from "./members.ts";
import { buildDemoPlans } from "./planner.ts";

/** Only the main is delegated. Drinks, required fries, exclusions and budgets stay fixed. */
export function chooseRandomMain(
  room: RoomState,
  memberId: string,
  menu: MenuItem[],
  random = Math.random(),
  now = Date.now(),
): MainChoice {
  const member = room.members.find((m) => m.id === memberId);
  if (!member) throw new Error("成员不存在");
  if (!Number.isFinite(random) || random < 0 || random >= 1)
    throw new Error("随机值无效");
  const choices = MAIN_CHOICES.filter((main) => {
    if (member.preferences.excludedMains?.includes(main)) return false;
    const members = room.members.map((m) =>
      m.id === memberId ? { ...m, preferences: { ...m.preferences, main } } : m,
    );
    return (
      buildDemoPlans(members, menu, room.revision, now, room.payment).plans
        .length > 0
    );
  });
  if (!choices.length)
    throw new Error(
      "暂时没有符合整桌预算与必选项的主餐，请调整预算或偏好后再试",
    );
  return choices[Math.floor(random * choices.length)];
}
