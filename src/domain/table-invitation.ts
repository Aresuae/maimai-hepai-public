export type TableInvitation = { id: string; invite: string };

export function parseTableInvitation(fragment: string): TableInvitation | null {
  const values = new URLSearchParams(fragment.replace(/^#/, ""));
  const id = values.get("table") ?? "";
  const invite = values.get("invite") ?? "";
  if (values.getAll("table").length !== 1 || values.getAll("invite").length !== 1 ||
    !/^[a-f0-9]{24}$/.test(id) || !/^[A-Za-z0-9_-]{32}$/.test(invite)) return null;
  return { id, invite };
}

export function sharedPublicOrigin(value: unknown): string {
  return typeof value === "string" && /^https:\/\/[a-z0-9-]+\.(lhr\.life|trycloudflare\.com|localhost\.run)$/.test(value) ? value : "";
}

export function tableInvitationLink(origin: unknown, id: string, invite: string, closed = false): string {
  const base = sharedPublicOrigin(origin);
  return !closed && base && /^[a-f0-9]{24}$/.test(id) && /^[A-Za-z0-9_-]{32}$/.test(invite)
    ? `${base}/#table=${id}&invite=${invite}` : "";
}
