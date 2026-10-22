import test from "node:test";
import assert from "node:assert/strict";
import {
  matchBuddyParties,
  transitionBuddyApplication,
  type BuddySearch,
} from "../src/domain/buddy-matching.ts";
import { DEMO_BUDDY_PARTIES } from "../src/providers/buddy-demo.ts";

const query: BuddySearch = {
  city: "上海市",
  area: "",
  window: "lunch",
  budgetCents: 5000,
  capacity: null,
  payment: "separate",
  tags: ["轻松聊天"],
};
test("matching respects city, meal window, budget, capacity and payment instead of widening constraints", () => {
  assert.equal(matchBuddyParties(DEMO_BUDDY_PARTIES, query).length, 3);
  assert.equal(
    matchBuddyParties(DEMO_BUDDY_PARTIES, { ...query, city: "上海" }).length,
    3,
  );
  for (const patch of [
    { city: "深圳市" },
    { budgetCents: 1900 },
    { capacity: 6 },
    { area: "无此商圈" },
    { budgetCents: NaN },
    { budgetCents: 100001 },
  ])
    assert.equal(
      matchBuddyParties(DEMO_BUDDY_PARTIES, { ...query, ...patch }).length,
      0,
    );
  assert.deepEqual(
    matchBuddyParties(DEMO_BUDDY_PARTIES, {
      ...query,
      capacity: 2,
      area: "黄浦",
    }).map((m) => m.party.id),
    ["demo-01"],
  );
  assert.deepEqual(
    matchBuddyParties(DEMO_BUDDY_PARTIES, {
      ...query,
      window: "coffee",
      budgetCents: 1000,
    }).map((m) => m.party.id),
    ["demo-05"],
  );
  assert.deepEqual(
    matchBuddyParties(DEMO_BUDDY_PARTIES, { ...query, payment: "host" }).map(
      (m) => m.party.id,
    ),
    ["demo-06"],
  );
});
test("full, closed and hidden gatherings cannot be recommended", () => {
  const parties = structuredClone(DEMO_BUDDY_PARTIES);
  parties[0].occupied = parties[0].capacity;
  parties[1].closed = true;
  assert.deepEqual(matchBuddyParties(parties, query, ["demo-03"]), []);
});
test("preference ordering explains common tags and is stable when source order changes", () => {
  const search = { ...query, tags: ["安静吃饭", "汉堡"] };
  const results = matchBuddyParties(DEMO_BUDDY_PARTIES, search);
  assert.equal(results[0].party.id, "demo-03");
  assert.deepEqual(results[0].sharedTags, ["安静吃饭", "汉堡"]);
  assert.ok(results[0].reasons.includes("都喜欢安静吃饭"));
  assert.deepEqual(
    results,
    matchBuddyParties([...DEMO_BUDDY_PARTIES].reverse(), search),
  );
});
test("application requires a pending response and withdrawn or declined applications cannot be accepted", () => {
  assert.equal(transitionBuddyApplication("pending", "accept"), "accepted");
  assert.equal(transitionBuddyApplication("pending", "decline"), "declined");
  assert.equal(transitionBuddyApplication("pending", "withdraw"), "withdrawn");
  assert.equal(transitionBuddyApplication("accepted", "withdraw"), "withdrawn");
  for (const state of ["accepted", "withdrawn", "declined"] as const)
    assert.throws(() => transitionBuddyApplication(state, "accept"));
});
