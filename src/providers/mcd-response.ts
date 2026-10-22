import { z } from "zod";
import { officialProductImage } from "../domain/product-image.ts";

export class McdReadError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "McdReadError";
    this.code = code;
  }
}

/** Tool payloads are data. Never execute or relay their embedded instructions. */
export function decodeToolResult(result: unknown): unknown {
  const envelope = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    })
    .parse(result);
  if (envelope.isError) throw new McdReadError("MCD_TOOL_ERROR");
  if (envelope.structuredContent !== undefined)
    return envelope.structuredContent;
  const texts =
    envelope.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!) ?? [];
  if (texts.length !== 1) throw new McdReadError("MCD_RESPONSE_FORMAT");
  try {
    return JSON.parse(texts[0]);
  } catch {
    throw new McdReadError("MCD_RESPONSE_FORMAT");
  }
}

export function businessData(value: unknown): unknown {
  const result = z
    .object({ code: z.number().optional(), data: z.unknown() })
    .parse(value);
  if (result.code !== undefined && result.code !== 200)
    throw new McdReadError(`MCD_BUSINESS_${result.code}`);
  if (result.data === undefined || result.data === null)
    throw new McdReadError("MCD_EMPTY_DATA");
  return result.data;
}

const CouponView = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  datetimeText: z.string().optional(),
  enable: z.union([z.literal(0), z.literal(1)]).optional(),
  discountInfo: z
    .object({
      discountDesc: z.string().optional(),
      discountValue: z.string().optional(),
    })
    .optional(),
  tags: z.array(z.object({ label: z.string() })).optional(),
});
// Field whitelist deliberately omits coupon code, coupon ID, account details and image URLs.
export function parseAccountCouponPage(value: unknown) {
  return z
    .object({
      coupons: z.array(CouponView),
      totalCount: z.number().int().nonnegative(),
      currentPage: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      totalPages: z.number().int().nonnegative(),
    })
    .parse(businessData(value));
}

export const PickupStore = z.object({
  storeCode: z.string().regex(/^\d+$/),
  storeName: z.string(),
  address: z.string(),
  businessStatus: z.boolean(),
  businessStartTime: z.string().optional(),
  businessEndTime: z.string().optional(),
  reservation: z.boolean().optional(),
  reservationTimeOptions: z
    .array(
      z.object({
        date: z.string(),
        reservationOptionText: z.string(),
        today: z.boolean(),
      }),
    )
    .optional(),
});
export function parseStores(value: unknown) {
  return z.array(PickupStore).parse(businessData(value));
}

export const StoreCoupon = z.object({
  couponCode: z.string(),
  couponId: z.string(),
  title: z.string(),
  tradeDateTime: z.string().optional(),
  products: z.array(
    z.object({ productCode: z.string(), productName: z.string() }),
  ),
});
export function parseStoreCoupons(value: unknown) {
  return z.array(StoreCoupon).parse(businessData(value));
}

const MealView = z.object({
  name: z.string(),
  image: z.unknown().optional().transform(officialProductImage),
  currentPrice: z.string().optional(),
  originalPrice: z.string().optional(),
  discountType: z.string().optional(),
  canWithOrder: z.boolean().optional(),
});
export function parseMenu(value: unknown) {
  return z
    .object({
      categories: z.array(
        z.object({
          name: z.string(),
          meals: z.array(
            z.object({
              code: z.string(),
              tags: z.array(z.string()).optional(),
            }),
          ),
        }),
      ),
      meals: z.record(z.string(), MealView),
    })
    .parse(businessData(value));
}

const Cents = z.number().int().nonnegative().max(10000000);
export function parseQuote(value: unknown) {
  // Exact observed schema: price is the final payable amount in cents, not "totalPrice".
  return z
    .object({
      price: Cents,
      originalPrice: Cents.optional(),
      discount: Cents.optional(),
      productPrice: Cents.optional(),
      productOriginalPrice: Cents.optional(),
      deliveryPrice: Cents.optional(),
      packingPrice: Cents.optional(),
      tablewarePrice: Cents.optional(),
      takeWayList: z.array(z.object({ code: z.string().min(1), title: z.string().min(1), subtitle: z.string().optional() })).optional(),
      productList: z.array(
        z.object({
          productCode: z.string(),
          productName: z.string(),
          quantity: z.number().int().positive(),
          subtotal: Cents,
          originalSubtotal: Cents.optional(),
        }),
      ),
    })
    .parse(businessData(value));
}

const Modification = z.object({
  items: z.array(
    z.object({
      values: z.array(
        z.object({
          code: z.string(),
          selectedKey: z.string().optional(),
          unselectedKey: z.string().optional(),
          selectedQuantity: z.number().int().nonnegative().optional(),
        }),
      ),
    }),
  ),
});
const Choice = z.object({
  code: z.string(),
  name: z.string(),
  isDefault: z.number().int().optional(),
  quantity: z.number().int().nonnegative().optional(),
  maxQuantity: z.number().int().min(-1).optional(),
  modification: Modification.optional(),
});
export const MealDetail = z.object({
  code: z.string(),
  name: z.string(),
  image: z.unknown().optional().transform(officialProductImage),
  modification: Modification.optional(),
  rounds: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        minQuantity: z.number().int().nonnegative(),
        maxQuantity: z.number().int().nonnegative(),
        choices: z.array(Choice),
      }),
    )
    .optional(),
});
export function parseMealDetail(value: unknown) {
  return MealDetail.parse(businessData(value));
}

function defaultModification(
  modification: z.infer<typeof Modification> | undefined,
) {
  if (!modification) return undefined;
  const values = modification.items.flatMap((group) =>
    group.values.flatMap((option) => {
      const quantity = option.selectedQuantity ?? 0;
      const key = quantity > 0 ? option.selectedKey : option.unselectedKey;
      if (quantity > 0 && !key)
        throw new McdReadError("MCD_DEFAULT_MODIFICATION_UNCLEAR");
      return key ? [{ code: option.code, key, quantity }] : [];
    }),
  );
  return values.length ? { values } : undefined;
}

/** For integration smoke quotes only: preserve official defaults; do not invent replacements. */
export function defaultQuoteItem(detail: z.infer<typeof MealDetail>) {
  const roundList = detail.rounds?.map((round) => {
    // Some live menus mark isDefault=1 on a zero-quantity option while a different
    // option already has quantity=1. Preserve explicit selected quantities.
    if (round.choices.some((choice) => choice.quantity === undefined))
      throw new McdReadError("MCD_DEFAULT_COMBO_UNCLEAR");
    const comboItemList = round.choices
      .filter((c) => c.quantity! > 0)
      .map((c) => {
        const quantity = c.quantity;
        if (
          !Number.isInteger(quantity) ||
          quantity! < 1 ||
          (c.maxQuantity !== undefined &&
            c.maxQuantity >= 0 &&
            quantity! > c.maxQuantity)
        )
          throw new McdReadError("MCD_DEFAULT_COMBO_UNCLEAR");
        return {
          code: c.code,
          quantity: quantity!,
          modification: defaultModification(c.modification),
        };
      });
    const count = comboItemList.reduce((n, c) => n + c.quantity, 0);
    if (count < round.minQuantity || count > round.maxQuantity)
      throw new McdReadError("MCD_DEFAULT_COMBO_UNCLEAR");
    return { round: String(round.id), comboItemList };
  });
  return {
    productCode: detail.code,
    quantity: 1,
    ...(roundList?.length ? { roundList } : {}),
    ...(detail.modification
      ? { modification: defaultModification(detail.modification) }
      : {}),
  };
}
