/** Official menu display prices are decimal yuan, distinct from quoted integer cents. */
export function menuDisplayPriceCents(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,5}(\.\d{1,2})?$/.test(value)) return undefined;
  const [yuan, fraction = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  return cents <= 1000000 ? cents : undefined;
}
