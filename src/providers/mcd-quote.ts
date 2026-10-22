import { z } from "zod";
import { createHash } from "node:crypto";
import { defaultQuoteItem, McdReadError, MealDetail } from "./mcd-response.ts";

// A local bounded smoke-check interface, not an official maximum or a shopping cart.
export const QuoteSelections = z
  .array(
    z
      .object({
        productCode: z.string().min(1).max(80),
        couponRef: z.string().min(1).optional(),
        configurationKey: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  )
  .min(1)
  .max(12);
export type QuoteSelection = z.infer<typeof QuoteSelections>[number];
export type CouponSecret = {
  storeCode: string;
  couponId: string;
  couponCode: string;
  products: string[];
};
export function defaultConfigurationKey(detail: z.infer<typeof MealDetail>) {
  return createHash("sha256")
    .update(JSON.stringify(defaultQuoteItem(detail)))
    .digest("hex");
}

/** An accepted quote must still contain exactly the requested products and quantities. */
export function assertQuotedProducts(
  requested: { productCode: string; quantity: number }[],
  quoted: { productCode: string; quantity: number }[],
) {
  const counts = (rows: typeof requested) => {
    const result = new Map<string, number>();
    for (const row of rows)
      result.set(
        row.productCode,
        (result.get(row.productCode) ?? 0) + row.quantity,
      );
    return result;
  };
  const expected = counts(requested),
    actual = counts(quoted);
  if (
    expected.size !== actual.size ||
    [...expected].some(([code, quantity]) => actual.get(code) !== quantity)
  )
    throw new McdReadError("MCD_QUOTE_ITEMS_MISMATCH");
}

/** Server-only: the returned request contains credentials and must never be logged or sent to a browser. */
export function buildDefaultQuoteRequest(
  storeCode: string,
  input: QuoteSelection[],
  details: z.infer<typeof MealDetail>[],
  couponSecrets: ReadonlyMap<string, CouponSecret>,
) {
  z.string()
    .regex(/^\d{1,20}$/)
    .parse(storeCode);
  const selections = QuoteSelections.parse(input);
  if (details.length !== selections.length)
    throw new McdReadError("MCD_PRODUCT_MISMATCH");
  const usedCoupons = new Set<string>();
  const items = selections.map((selection, index) => {
    const detail = MealDetail.parse(details[index]);
    if (detail.code !== selection.productCode)
      throw new McdReadError("MCD_PRODUCT_MISMATCH");
    const item = defaultQuoteItem(detail);
    if (
      selection.configurationKey &&
      selection.configurationKey !== defaultConfigurationKey(detail)
    )
      throw new McdReadError("MCD_CONFIGURATION_CHANGED");
    if (!selection.couponRef) return item;
    const coupon = couponSecrets.get(selection.couponRef);
    if (
      !coupon ||
      coupon.storeCode !== storeCode ||
      !coupon.products.includes(selection.productCode)
    )
      throw new McdReadError("MCD_COUPON_CONTEXT_MISMATCH");
    const identity = JSON.stringify([coupon.couponId, coupon.couponCode]);
    if (usedCoupons.has(identity)) throw new McdReadError("MCD_COUPON_REUSED");
    usedCoupons.add(identity);
    return {
      ...item,
      couponId: coupon.couponId,
      couponCode: coupon.couponCode,
    };
  });
  // No withOrder: quotation never opts into buying a membership card.
  return { storeCode, orderType: 1, beType: 1, needTableware: false, items };
}
