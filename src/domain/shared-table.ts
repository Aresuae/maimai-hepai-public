import { z } from "zod";
import { officialProductImage } from "./product-image.ts";

export const SharedCatalogItem = z.object({
  code: z.string().min(1).max(80), name: z.string().min(1).max(100),
  category: z.enum(["mains", "snacks", "drinks", "icecream", "other"]),
  menuPriceCents: z.number().int().min(0).max(1000000).optional(),
  image: z.string().max(1024).refine(value => officialProductImage(value) === value, "仅支持官方商品图片").optional(),
  groups: z.array(z.string().min(1).max(100)).max(30).optional(),
}).strict();
export const SharedCatalog = z.object({
  storeCode: z.string().regex(/^\d{1,20}$/), storeName: z.string().min(1).max(100),
  items: z.array(SharedCatalogItem).min(1).max(500),
}).strict().refine(c => new Set(c.items.map(i => i.code)).size === c.items.length, "餐品不能重复");
export const SharedPicks = z.array(z.object({ code: z.string().min(1).max(80), quantity: z.number().int().min(1).max(6) }).strict()).max(12)
  .refine(rows => new Set(rows.map(row => row.code)).size === rows.length, "餐品不能重复");
export type SharedCatalogData = z.infer<typeof SharedCatalog>;
export type SharedPick = z.infer<typeof SharedPicks>[number];
export type SharedMember = { id: string; name: string; budgetCents: number; revision: number; picks: SharedPick[]; ready: boolean; host: boolean; submitted?: boolean };
export type SharedTable = { id: string; title: string; capacity: number; revision: number; managementRevision?: number; closed: boolean; expiresAt: number; catalog: SharedCatalogData; members: SharedMember[]; myMemberId: string; isHost: boolean; invite?: string; publicOrigin?: string };
export type SharedImport = { id: string; revision: number; managementRevision: number; catalog: SharedCatalogData; members: SharedMember[] };
export const SharedCheckout = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/), revision: z.number().int().nonnegative(), managementRevision: z.number().int().nonnegative(),
  members: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), revision: z.number().int().nonnegative() }).strict()).min(1).max(6)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "结算成员不能重复"),
}).strict();
export type SharedCheckoutRef = z.infer<typeof SharedCheckout>;
export function sharedCheckoutRef(draft: SharedImport): SharedCheckoutRef {
  return { id: draft.id, revision: draft.revision, managementRevision: draft.managementRevision, members: draft.members.map(({ id, revision }) => ({ id, revision })) };
}
export function sharedSelectionCurrent(table: SharedTable, ref: SharedCheckoutRef, now = Date.now()): boolean {
  return table.id === ref.id && !table.closed && table.expiresAt > now && (table.managementRevision ?? 0) === ref.managementRevision && ref.members.length > 0 &&
    ref.members.every(selected => table.members.some(m => m.id === selected.id && m.revision === selected.revision && m.ready && m.picks.length > 0 && !m.submitted));
}
