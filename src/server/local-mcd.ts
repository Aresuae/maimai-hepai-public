import { z } from "zod";
import { McdReadOnlyClient } from "../providers/mcd-readonly.ts";
import {
  defaultConfigurationKey,
  QuoteSelections,
} from "../providers/mcd-quote.ts";

export function allowLocalMcdRequest(
  method: string,
  host: string,
  origin: string,
  remoteAddress: string,
  contentType: string,
) {
  return (
    method === "POST" &&
    /^(127\.0\.0\.1|localhost):5173$/.test(host) &&
    origin === `http://${host}` &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress) &&
    contentType.split(";")[0].trim() === "application/json"
  );
}

const StoreCode = z.string().regex(/^\d{1,20}$/);
export const LocalMcdInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("stores"),
      city: z.string().trim().min(1).max(30),
      keyword: z.string().trim().min(1).max(100),
    })
    .strict(),
  z.object({ action: z.literal("menu"), storeCode: StoreCode }).strict(),
  z
    .object({
      action: z.literal("detail"),
      storeCode: StoreCode,
      productCode: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("quote"),
      storeCode: StoreCode,
      selections: QuoteSelections.refine(
        (items) => items.every((item) => !!item.configurationKey),
        "请重新查看并选择餐品",
      ),
    })
    .strict(),
]);

/** Requires a trusted credential supplied by the caller: local owner or authenticated isolated guest. */
export async function localMcdAction(
  raw: unknown,
  env: Record<string, string | undefined>,
) {
  const input = LocalMcdInput.parse(raw);
  const client = await McdReadOnlyClient.connect(env);
  try {
    const base = {
      source: "live" as const,
      fetchedAt: Date.now(),
      dining: "pickup" as const,
    };
    if (input.action === "stores")
      return {
        ...base,
        stores: await client.searchPickupStores(input.city, input.keyword),
      };
    if (input.action === "menu") {
      const menu = await client.menu(input.storeCode);
      const coupons = await client.storeCoupons(input.storeCode);
      return { ...base, storeCode: input.storeCode, menu, coupons };
    }
    if (input.action === "detail") {
      const detail = await client.detail(input.storeCode, input.productCode);
      return {
        ...base,
        storeCode: input.storeCode,
        detail,
        configurationKey: defaultConfigurationKey(detail),
      };
    }
    // Re-fetch coupon eligibility in the quote's store/time context. Opaque references
    // identify the same instance across short-lived connections, never coupon credentials.
    if (input.selections.some((s) => s.couponRef))
      await client.storeCoupons(input.storeCode);
    return await client.quoteDefaults(input.storeCode, input.selections);
  } finally {
    await client.close();
  }
}

export function safeLocalMcdError(error: unknown) {
  const code =
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^MCD_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "MCD_REQUEST_FAILED";
  return {
    code,
    message:
      code === "MCD_COUPON_CONTEXT_MISMATCH"
        ? "这张券的可用状态已变化，请刷新门店菜单后重选。"
        : code === "MCD_CONFIGURATION_CHANGED"
          ? "套餐搭配已变化，请移除这份餐品，重新查看内容后加入。"
          : "暂时无法读取或核价，请重试刚才的操作。已选餐品会保留，当前没有可用的新报价。",
  };
}
