import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { createHmac, randomBytes } from "node:crypto";
import { readMcpConfig } from "../../scripts/mcp-config.mjs";
import {
  decodeToolResult,
  McdReadError,
  parseAccountCouponPage,
  parseStores,
  parseStoreCoupons,
  parseMenu,
  parseMealDetail,
  parseQuote,
} from "./mcd-response.ts";
import {
  assertQuotedProducts,
  buildDefaultQuoteRequest,
  QuoteSelections,
} from "./mcd-quote.ts";
import type { CouponSecret, QuoteSelection } from "./mcd-quote.ts";

const ALLOWED = new Set([
  "query-my-coupons",
  "query-nearby-stores",
  "query-store-coupons",
  "query-meals",
  "query-meal-detail",
  "calculate-price",
]);
const couponReferenceKey = randomBytes(32);
export function assertReadOnlyTool(name: string) {
  if (!ALLOWED.has(name)) throw new McdReadError("MCD_TOOL_NOT_ALLOWED");
}

/** Server/CLI only. This client never calls write tools. */
export class McdReadOnlyClient {
  private client: Client;
  private signal: AbortSignal;
  private couponSecrets = new Map<string, CouponSecret>();
  private constructor(client: Client, signal: AbortSignal) {
    this.client = client;
    this.signal = signal;
  }

  static async connect(env: Record<string, string | undefined> = process.env) {
    const { token, url } = readMcpConfig(env);
    const signal = AbortSignal.timeout(120_000);
    const client = new Client(
      { name: "maimai-hepai-readonly", version: "0.1.0" },
      { listMaxPages: 20 },
    );
    client.onerror = () => {};
    try {
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          authProvider: { token: async () => token },
          requestInit: { redirect: "error" },
        }),
        { signal, timeout: 15000 },
      );
      // Populate the SDK's actual schema cache for result validation.
      await client.listTools(undefined, { signal, timeout: 15000 });
      return new McdReadOnlyClient(client, signal);
    } catch {
      await client.close().catch(() => {});
      throw new McdReadError("MCD_CONNECTION_FAILED");
    }
  }
  async close() {
    this.couponSecrets.clear();
    await this.client.close().catch(() => {});
  }
  private async call(name: string, args: Record<string, unknown>) {
    assertReadOnlyTool(name);
    try {
      return decodeToolResult(
        await this.client.callTool(
          { name, arguments: args },
          { signal: this.signal, timeout: 15000 },
        ),
      );
    } catch (error) {
      if (error instanceof McdReadError) throw error;
      // Never expose raw SDK errors (may contain tool results, IDs, headers or server text).
      throw new McdReadError("MCD_READ_FAILED");
    }
  }
  async accountCoupons(page = 1) {
    z.number().int().min(1).max(5).parse(page);
    return parseAccountCouponPage(
      await this.call("query-my-coupons", {
        page: String(page),
        pageSize: "200",
      }),
    );
  }
  async searchPickupStores(city: string, keyword: string) {
    const input = z
      .object({
        city: z.string().trim().min(1).max(30),
        keyword: z.string().trim().min(1).max(100),
      })
      .parse({ city, keyword });
    return parseStores(
      await this.call("query-nearby-stores", {
        ...input,
        searchType: 2,
        beType: 1,
      }),
    );
  }
  private context(storeCode: string) {
    z.string()
      .regex(/^\d{1,20}$/)
      .parse(storeCode);
    return { storeCode, orderType: 1, beType: 1 };
  }
  async storeCoupons(storeCode: string) {
    const coupons = parseStoreCoupons(
      await this.call("query-store-coupons", this.context(storeCode)),
    );
    // Coupon credentials stay inside this short-lived server-side session.
    this.couponSecrets.clear();
    return coupons.map((c) => {
      const ref = createHmac("sha256", couponReferenceKey)
        .update(JSON.stringify([storeCode, c.couponId, c.couponCode]))
        .digest("hex");
      this.couponSecrets.set(ref, {
        storeCode,
        couponId: c.couponId,
        couponCode: c.couponCode,
        products: c.products.map((p) => p.productCode),
      });
      return {
        ref,
        title: c.title,
        tradeDateTime: c.tradeDateTime,
        products: c.products,
      };
    });
  }
  async menu(storeCode: string) {
    return parseMenu(await this.call("query-meals", this.context(storeCode)));
  }
  async detail(storeCode: string, code: string) {
    z.string().min(1).max(80).parse(code);
    return parseMealDetail(
      await this.call("query-meal-detail", {
        ...this.context(storeCode),
        code,
      }),
    );
  }
  async quoteDefault(storeCode: string, code: string, couponRef?: string) {
    const result = await this.quoteDefaults(storeCode, [
      { productCode: code, couponRef },
    ]);
    return { ...result, name: result.selections[0].name };
  }
  async quoteDefaults(storeCode: string, input: QuoteSelection[]) {
    return (await this.prepareCheckout(storeCode, input)).view;
  }
  /** Server-only: request contains coupon credentials. Never return it through an HTTP response. */
  async prepareCheckout(storeCode: string, input: QuoteSelection[]) {
    this.context(storeCode);
    const selections = QuoteSelections.parse(input);
    const details: ReturnType<typeof parseMealDetail>[] = [];
    for (const selection of selections)
      details.push(await this.detail(storeCode, selection.productCode));
    const request = buildDefaultQuoteRequest(
      storeCode,
      selections,
      details,
      this.couponSecrets,
    );
    const quote = parseQuote(await this.call("calculate-price", request));
    assertQuotedProducts(request.items, quote.productList);
    return { request, view: {
      source: "live" as const,
      quotedAt: Date.now(),
      storeCode,
      dining: "pickup" as const,
      selections: selections.map((selection, index) => ({
        productCode: selection.productCode,
        name: details[index].name,
        couponSelected: !!selection.couponRef,
      })),
      quote,
    } };
  }
}
