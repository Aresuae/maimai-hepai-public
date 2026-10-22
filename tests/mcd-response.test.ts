import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeToolResult,
  businessData,
  parseAccountCouponPage,
  parseMenu,
  parseQuote,
  parseMealDetail,
  defaultQuoteItem,
} from "../src/providers/mcd-response.ts";
import { assertReadOnlyTool } from "../src/providers/mcd-readonly.ts";
import {
  assertQuotedProducts,
  buildDefaultQuoteRequest,
  defaultConfigurationKey,
  QuoteSelections,
} from "../src/providers/mcd-quote.ts";

const response = (data: unknown) => ({ code: 200, data });
const plainMeal = (code = "a") => ({ code, name: "测试商品" });

test("a live quote rejects changed meal composition instead of silently replacing the viewed configuration", () => {
  const detail = comboDetail();
  const configurationKey = defaultConfigurationKey(detail);
  const selections = [{ productCode: detail.code, configurationKey }];
  assert.doesNotThrow(() =>
    buildDefaultQuoteRequest("123", selections, [detail], new Map()),
  );
  detail.rounds![0].choices[0].quantity = 0;
  detail.rounds![0].choices[1].quantity = 1;
  assert.throws(
    () => buildDefaultQuoteRequest("123", selections, [detail], new Map()),
    /MCD_CONFIGURATION_CHANGED/,
  );
});

test("tool responses reject errors and ambiguous text without relaying remote contents", () => {
  assert.deepEqual(
    decodeToolResult({ content: [{ type: "text", text: '{"data":[]}' }] }),
    { data: [] },
  );
  assert.deepEqual(
    decodeToolResult({ structuredContent: { data: [] }, content: [] }),
    { data: [] },
  );
  for (const payload of [
    {
      isError: true,
      content: [{ type: "text", text: "private-error-fixture" }],
    },
    { content: [{ type: "text", text: "not-json" }] },
    {
      content: [
        { type: "text", text: "{}" },
        { type: "text", text: "{}" },
      ],
    },
  ])
    assert.throws(() => decodeToolResult(payload), /^McdReadError: MCD_/);
  assert.throws(
    () => businessData({ code: 403, data: [] }),
    /MCD_BUSINESS_403/,
  );
  assert.throws(() => businessData({ data: null }), /MCD_EMPTY_DATA/);
});

test("coupon view strips credential fields and retains disabled assets without asserting store eligibility", () => {
  const result = parseAccountCouponPage(
    response({
      coupons: [
        {
          title: "测试券",
          enable: 0,
          id: "private-id",
          code: "private-code",
          token: "private-token",
          tags: [{ label: "早餐", hidden: "private-tag" }],
        },
      ],
      totalCount: 1,
      currentPage: 1,
      pageSize: 200,
      totalPages: 1,
      account: "private-account",
    }),
  );
  assert.deepEqual(result.coupons[0], {
    title: "测试券",
    enable: 0,
    tags: [{ label: "早餐" }],
  });
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.ok(!("storeEligible" in result.coupons[0]));
});

test("menu retains promotional-card distinction without forwarding card purchase details", () => {
  const result = parseMenu(
    response({
      categories: [],
      meals: {
        a: {
          name: "需随单买卡",
          currentPrice: "9.9",
          canWithOrder: true,
          withOrder: { cardId: "private-card" },
        },
        b: {
          name: "标注权益价",
          discountType: "麦金卡优惠",
          canWithOrder: false,
        },
      },
    }),
  );
  assert.equal(result.meals.a.canWithOrder, true);
  assert.equal(result.meals.b.canWithOrder, false);
  assert.ok(!JSON.stringify(result).includes("private-card"));
});

test("quote requires explicit integer cents; missing, negative, fractional and wrong amount fields fail", () => {
  const productList = [
    { productCode: "a", productName: "测试", quantity: 1, subtotal: 990 },
  ];
  assert.equal(
    parseQuote(response({ price: 990, totalPrice: 123, productList })).price,
    990,
  );
  assert.equal(
    parseQuote(
      response({ price: 0, productList: [{ ...productList[0], subtotal: 0 }] }),
    ).price,
    0,
  );
  for (const amount of [undefined, -1, 9.9, "990", NaN, Infinity])
    assert.throws(() =>
      parseQuote(response({ price: amount, totalPrice: 990, productList })),
    );
  assert.throws(() => parseQuote(response({ price: 990 })));
});

function comboDetail() {
  return parseMealDetail(
    response({
      code: "combo",
      name: "测试套餐",
      rounds: [
        {
          id: 1,
          name: "选一",
          minQuantity: 1,
          maxQuantity: 1,
          choices: [
            {
              code: "main",
              name: "默认",
              isDefault: 1,
              quantity: 1,
              maxQuantity: -1,
            },
            {
              code: "alternative",
              name: "非默认",
              isDefault: 0,
              quantity: 0,
              maxQuantity: 1,
            },
          ],
        },
      ],
    }),
  );
}

test("default combo supports observed -1 option limit while enforcing round constraints", () => {
  const detail = comboDetail();
  const item = defaultQuoteItem(detail);
  assert.deepEqual(
    item.roundList?.[0].comboItemList.map(({ code, quantity }) => ({
      code,
      quantity,
    })),
    [{ code: "main", quantity: 1 }],
  );
  detail.rounds![0].choices[0].quantity = 2;
  assert.throws(() => defaultQuoteItem(detail), /MCD_DEFAULT_COMBO_UNCLEAR/);
  detail.rounds![0].choices[0].quantity = undefined;
  assert.throws(() => defaultQuoteItem(detail), /MCD_DEFAULT_COMBO_UNCLEAR/);
  const capped = comboDetail();
  capped.rounds![0].choices[0].maxQuantity = 0;
  assert.throws(() => defaultQuoteItem(capped), /MCD_DEFAULT_COMBO_UNCLEAR/);
});

test("official selected and unselected modification keys are preserved; unclear defaults fail", () => {
  const detail = parseMealDetail(
    response({
      ...plainMeal(),
      modification: {
        items: [
          {
            values: [
              {
                code: "sugar",
                selectedKey: "ADD",
                unselectedKey: "NONE",
                selectedQuantity: 2,
              },
              {
                code: "milk",
                selectedKey: "ADD",
                unselectedKey: "NONE",
                selectedQuantity: 0,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(defaultQuoteItem(detail).modification, {
    values: [
      { code: "sugar", key: "ADD", quantity: 2 },
      { code: "milk", key: "NONE", quantity: 0 },
    ],
  });
  delete detail.modification!.items[0].values[0].selectedKey;
  assert.throws(
    () => defaultQuoteItem(detail),
    /MCD_DEFAULT_MODIFICATION_UNCLEAR/,
  );
});

test("coupon quote requests bind credentials to store and product and prevent duplicate instance reuse", () => {
  const secret = {
    storeCode: "123",
    couponId: "fake-id",
    couponCode: "fake-code",
    products: ["a", "b"],
  };
  const secrets = new Map([
    ["ref", secret],
    ["alias", secret],
  ]);
  const request = buildDefaultQuoteRequest(
    "123",
    [{ productCode: "a", couponRef: "ref" }, { productCode: "b" }],
    [plainMeal(), plainMeal("b")],
    secrets,
  );
  assert.equal(request.items.length, 2);
  assert.equal(request.beType, 1);
  assert.equal(request.orderType, 1);
  assert.ok(!("withOrder" in request));
  assert.ok(!("beCode" in request));
  assert.deepEqual(request.items[0], {
    productCode: "a",
    quantity: 1,
    couponId: "fake-id",
    couponCode: "fake-code",
  });
  assert.throws(
    () =>
      buildDefaultQuoteRequest(
        "456",
        [{ productCode: "a", couponRef: "ref" }],
        [plainMeal()],
        secrets,
      ),
    /MCD_COUPON_CONTEXT_MISMATCH/,
  );
  assert.throws(
    () =>
      buildDefaultQuoteRequest(
        "123",
        [{ productCode: "c", couponRef: "ref" }],
        [plainMeal("c")],
        secrets,
      ),
    /MCD_COUPON_CONTEXT_MISMATCH/,
  );
  assert.throws(
    () =>
      buildDefaultQuoteRequest(
        "123",
        [{ productCode: "a", couponRef: "stale" }],
        [plainMeal()],
        secrets,
      ),
    /MCD_COUPON_CONTEXT_MISMATCH/,
  );
  assert.throws(
    () =>
      buildDefaultQuoteRequest(
        "123",
        [
          { productCode: "a", couponRef: "ref" },
          { productCode: "b", couponRef: "alias" },
        ],
        [plainMeal(), plainMeal("b")],
        secrets,
      ),
    /MCD_COUPON_REUSED/,
  );
});

test("bounded quote selection rejects product mismatch and unimplemented purchase or quantity flags", () => {
  assert.throws(() => QuoteSelections.parse([]));
  assert.throws(() =>
    QuoteSelections.parse(
      Array.from({ length: 13 }, () => ({ productCode: "a" })),
    ),
  );
  assert.throws(() =>
    QuoteSelections.parse([{ productCode: "a", quantity: 2 }]),
  );
  assert.throws(() =>
    QuoteSelections.parse([{ productCode: "a", withOrder: { cardId: "x" } }]),
  );
  assert.throws(
    () =>
      buildDefaultQuoteRequest(
        "123",
        [{ productCode: "b" }],
        [plainMeal()],
        new Map(),
      ),
    /MCD_PRODUCT_MISMATCH/,
  );
});

test("quote cannot silently drop, replace, add or change quantities of requested products", () => {
  const expected = [
    { productCode: "a", quantity: 1 },
    { productCode: "a", quantity: 1 },
    { productCode: "b", quantity: 1 },
  ];
  assert.doesNotThrow(() =>
    assertQuotedProducts(expected, [
      { productCode: "b", quantity: 1 },
      { productCode: "a", quantity: 2 },
    ]),
  );
  for (const quoted of [
    [],
    [{ productCode: "a", quantity: 2 }],
    [...expected, { productCode: "x", quantity: 1 }],
    [
      { productCode: "a", quantity: 3 },
      { productCode: "b", quantity: 1 },
    ],
  ])
    assert.throws(
      () => assertQuotedProducts(expected, quoted),
      /MCD_QUOTE_ITEMS_MISMATCH/,
    );
});

test("combo preserves explicit selected quantities when the default flag points to an unselected choice", () => {
  const detail = comboDetail();
  detail.rounds![0].choices[0].quantity = 0;
  detail.rounds![0].choices[1].quantity = 1;
  const items = defaultQuoteItem(detail).roundList![0].comboItemList;
  assert.deepEqual(
    items.map(({ code, quantity }) => ({ code, quantity })),
    [{ code: "alternative", quantity: 1 }],
  );
  detail.rounds![0].choices[1].quantity = 0;
  assert.throws(() => defaultQuoteItem(detail), /MCD_DEFAULT_COMBO_UNCLEAR/);
});

test("readonly client denies redemption, card purchase and order tools", () => {
  for (const name of [
    "create-order",
    "auto-bind-coupons",
    "redeem-coupon",
    "buy-card",
    "cancel-order",
    "unknown-tool",
  ])
    assert.throws(() => assertReadOnlyTool(name), /MCD_TOOL_NOT_ALLOWED/);
  for (const name of [
    "query-my-coupons",
    "query-nearby-stores",
    "query-store-coupons",
    "query-meals",
    "query-meal-detail",
    "calculate-price",
  ])
    assert.doesNotThrow(() => assertReadOnlyTool(name));
});
