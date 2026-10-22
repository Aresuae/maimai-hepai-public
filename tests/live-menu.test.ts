import test from "node:test";
import assert from "node:assert/strict";
import {
  allowLocalMcdRequest,
  LocalMcdInput,
  safeLocalMcdError,
} from "../src/server/local-mcd.ts";
import {
  allocateLiveQuote,
  type LiveCartLine,
  type LiveQuote,
} from "../src/domain/live-menu.ts";
import { DEMO_MEMBERS } from "../src/providers/demo.ts";

const lines: LiveCartLine[] = [
  {
    id: "1",
    memberId: "a",
    productCode: "burger",
    name: "具体汉堡",
    parts: [],
  },
  {
    id: "2",
    memberId: "b",
    productCode: "burger",
    name: "具体汉堡",
    parts: [],
  },
  {
    id: "3",
    memberId: "b",
    productCode: "coffee",
    name: "具体咖啡",
    parts: [],
  },
];
const quote: LiveQuote = {
  source: "live",
  storeCode: "123",
  quotedAt: 123,
  quote: {
    price: 3101,
    productList: [
      {
        productCode: "burger",
        productName: "具体汉堡",
        quantity: 2,
        subtotal: 2001,
      },
      {
        productCode: "coffee",
        productName: "具体咖啡",
        quantity: 1,
        subtotal: 1000,
      },
    ],
  },
};
test("local account bridge rejects remote hosts, sockets, origins and simple cross-site requests", () => {
  assert.equal(
    allowLocalMcdRequest(
      "POST",
      "127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "::ffff:127.0.0.1",
      "application/json; charset=utf-8",
    ),
    true,
  );
  for (const [method, host, origin, remote, type] of [
    [
      "GET",
      "127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "127.0.0.1",
      "application/json",
    ],
    [
      "POST",
      "public.example:5173",
      "http://public.example:5173",
      "127.0.0.1",
      "application/json",
    ],
    [
      "POST",
      "127.0.0.1:5173",
      "https://evil.example",
      "127.0.0.1",
      "application/json",
    ],
    [
      "POST",
      "127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "192.168.1.5",
      "application/json",
    ],
    [
      "POST",
      "127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "127.0.0.1",
      "text/plain",
    ],
    ["POST", "127.0.0.1:5173", "", "127.0.0.1", "application/json"],
  ])
    assert.equal(
      allowLocalMcdRequest(method, host, origin, remote, type),
      false,
    );
});
test("local bridge accepts only bounded read actions and no caller credentials or purchase payloads", () => {
  assert.doesNotThrow(() =>
    LocalMcdInput.parse({
      action: "quote",
      storeCode: "123",
      selections: [
        {
          productCode: "x",
          couponRef: "opaque-ref",
          configurationKey: "a".repeat(64),
        },
      ],
    }),
  );
  for (const body of [
    { action: "create-order", storeCode: "123" },
    { action: "menu", storeCode: "123", token: "private-test" },
    {
      action: "quote",
      storeCode: "123",
      withOrder: {},
      selections: [{ productCode: "x" }],
    },
    {
      action: "quote",
      storeCode: "123",
      selections: [{ productCode: "x", couponCode: "private-test" }],
    },
    {
      action: "quote",
      storeCode: "123",
      selections: Array.from({ length: 13 }, () => ({ productCode: "x" })),
    },
  ])
    assert.throws(() => LocalMcdInput.parse(body));
  assert.ok(
    !JSON.stringify(safeLocalMcdError(new Error("private-test"))).includes(
      "private-test",
    ),
  );
});
test("live split preserves official total including adjustments, with zero for members without food", () => {
  const { allocations, conflicts } = allocateLiveQuote(
    lines,
    quote,
    DEMO_MEMBERS,
    { mode: "split" },
  );
  assert.equal(
    allocations.reduce((sum, a) => sum + a.payableCents, 0),
    3101,
  );
  assert.equal(
    allocations.reduce((sum, a) => sum + a.mealCents, 0),
    3101,
  );
  assert.deepEqual(
    allocations.slice(2).map((a) => a.payableCents),
    [0, 0],
  );
  assert.equal(conflicts.length, 0);
  assert.deepEqual(
    allocateLiveQuote([...lines].reverse(), quote, DEMO_MEMBERS, {
      mode: "split",
    }),
    { allocations, conflicts },
  );
});
test("live budget violations remain visible and treat mode charges only the chosen payer", () => {
  const members = structuredClone(DEMO_MEMBERS);
  members[0].preferences.budgetCents = 100;
  assert.match(
    allocateLiveQuote(lines, quote, members, { mode: "split" }).conflicts[0],
    /小麦/,
  );
  const treated = allocateLiveQuote(lines, quote, members, {
    mode: "treat",
    payerId: "d",
    totalBudgetCents: 3100,
  });
  assert.deepEqual(
    treated.allocations.map((a) => a.payableCents),
    [0, 0, 0, 3101],
  );
  assert.equal(treated.conflicts.length, 1);
});
test("live allocation rejects stale members, duplicate line identities, dropped products and changed quantities", () => {
  assert.throws(() =>
    allocateLiveQuote([...lines, lines[0]], quote, DEMO_MEMBERS, {
      mode: "split",
    }),
  );
  assert.throws(() =>
    allocateLiveQuote(lines, quote, DEMO_MEMBERS.slice(1), { mode: "split" }),
  );
  assert.throws(() =>
    allocateLiveQuote(lines.slice(1), quote, DEMO_MEMBERS, { mode: "split" }),
  );
  const dropped = structuredClone(quote);
  dropped.quote.productList.pop();
  assert.throws(() =>
    allocateLiveQuote(lines, dropped, DEMO_MEMBERS, { mode: "split" }),
  );
});
test("explicit zero quote stays zero without substituting menu estimates", () => {
  const free = structuredClone(quote);
  free.quote.price = 0;
  free.quote.productList.forEach((p) => {
    p.subtotal = 0;
  });
  assert.ok(
    allocateLiveQuote(lines, free, DEMO_MEMBERS, {
      mode: "split",
    }).allocations.every((a) => a.payableCents === 0),
  );
});
