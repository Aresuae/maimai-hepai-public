import type { Member } from "./types.ts";
import { validateMembers } from "./members.ts";

export const BUDDY_STORAGE_KEY = "maimai-hepai:buddies:v1";
export interface BuddyGroup {
  id: string;
  name: string;
  members: Member[];
}

// Whitelist fields: no room state, ballots, payment commitments or credentials are saved.
export function makeBuddyGroup(
  id: string,
  name: string,
  members: Member[],
): BuddyGroup {
  validateMembers(members);
  if (
    !/^[a-zA-Z0-9_-]{1,60}$/.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 24
  )
    throw new Error("饭搭子分组名称需要 1—24 个字符");
  return {
    id,
    name: name.trim(),
    members: members.map((m) => ({
      id: m.id,
      name: m.name.trim(),
      color: m.color,
      preferences: {
        budgetCents: m.preferences.budgetCents,
        main: m.preferences.main,
        drink: m.preferences.drink,
        fries: m.preferences.fries,
        acceptsSharing: m.preferences.acceptsSharing,
        excludedMains: [...(m.preferences.excludedMains ?? [])],
      },
    })),
  };
}

export function parseBuddyGroups(raw: string | null): BuddyGroup[] {
  if (raw === null) return [];
  if (raw.length > 100000) throw new Error("本地饭搭子数据过大，未加载");
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.groups) ||
    data.groups.length > 8
  )
    throw new Error("本地饭搭子格式不兼容，未加载");
  const groups: BuddyGroup[] = data.groups.map((g: BuddyGroup) =>
    makeBuddyGroup(g.id, g.name, g.members),
  );
  if (new Set(groups.map((g) => g.id)).size !== groups.length)
    throw new Error("饭搭子分组 ID 重复");
  return groups;
}

export function serializeBuddyGroups(groups: BuddyGroup[]): string {
  const raw = JSON.stringify({
    version: 1,
    groups: groups.map((g) => makeBuddyGroup(g.id, g.name, g.members)),
  });
  parseBuddyGroups(raw);
  return raw;
}
