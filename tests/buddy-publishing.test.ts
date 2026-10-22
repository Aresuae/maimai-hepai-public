import test from "node:test";
import assert from "node:assert/strict";
import {
  makePublishedBuddy,
  parseBudgetYuan,
  parsePublishedBuddies,
  publishedBuddyStatus,
  serializePublishedBuddies,
  setPublishedBuddyClosed,
  shanghaiDate,
  type BuddyPublishDraft,
} from "../src/domain/buddy-publishing.ts";
import {
  matchBuddyParties,
  type BuddySearch,
} from "../src/domain/buddy-matching.ts";

const now = Date.parse("2026-10-19T03:00:00Z"); // Shanghai 11:00
const draft: BuddyPublishDraft = {
  host: " 我 ",
  title: " 午餐搭子 ",
  city: " 上海市 ",
  area: "黄浦",
  mealDate: "2026-10-19",
  window: "lunch",
  capacity: 3,
  minBudgetCents: 2500,
  maxBudgetCents: 5000,
  tags: ["薯条", "薯条"],
  payment: "separate",
};
const query: BuddySearch = {
  city: "上海",
  area: "黄浦",
  window: "lunch",
  budgetCents: 5000,
  capacity: 3,
  tags: [],
  payment: "separate",
};
test("publishing normalizes a bounded local gathering with the host occupying one seat", () => {
  const party = makePublishedBuddy(draft, "local-first", now);
  assert.equal(party.host, "我");
  assert.equal(party.title, "午餐搭子");
  assert.equal(party.occupied, 1);
  assert.equal(party.source, "local");
  assert.equal(party.capacity - party.occupied, 2);
  assert.deepEqual(party.tags, ["薯条"]);
  assert.equal(matchBuddyParties([party], query, [], now).length, 1);
});
test("publishing rejects inverted budgets, invalid dates, missing locations and unsupported capacity", () => {
  for (const patch of [
    { minBudgetCents: 5001 },
    { maxBudgetCents: 100001 },
    { minBudgetCents: 2500.5 },
    { capacity: 7 },
    { capacity: 1 },
    { title: " " },
    { host: "" },
    { area: "" },
    { mealDate: "2026-02-30" },
    { mealDate: "2026-10-18" },
  ]) {
    assert.throws(() =>
      makePublishedBuddy({ ...draft, ...patch }, "local-first", now),
    );
  }
  assert.throws(() =>
    makePublishedBuddy(
      { ...draft, token: "private" } as BuddyPublishDraft,
      "local-first",
      now,
    ),
  );
});
test("date and expiration use Shanghai time and cannot reopen a meal that has begun", () => {
  assert.equal(shanghaiDate(Date.parse("2026-10-18T16:05:00Z")), "2026-10-19");
  const start = Date.parse("2026-10-19T04:00:00Z");
  const party = makePublishedBuddy(draft, "local-first", now);
  assert.equal(publishedBuddyStatus(party, start - 1), "open");
  assert.equal(publishedBuddyStatus(party, start), "expired");
  assert.equal(matchBuddyParties([party], query, [], start).length, 0);
  assert.throws(() => makePublishedBuddy(draft, "local-first", start));
  assert.throws(() =>
    setPublishedBuddyClosed({ ...party, closed: true }, false, start),
  );
});
test("editing preserves identity, creation time and closed state; closing removes a listing from discovery", () => {
  const original = makePublishedBuddy(draft, "local-first", now);
  const closed = setPublishedBuddyClosed(original, true, now + 1000);
  assert.equal(matchBuddyParties([closed], query, [], now + 1000).length, 0);
  const edited = makePublishedBuddy(
    { ...draft, capacity: 4, title: "修改后的饭局" },
    original.id,
    now + 2000,
    closed,
  );
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.closed, true);
  assert.equal(edited.title, "修改后的饭局");
  assert.throws(() =>
    makePublishedBuddy(draft, "local-other", now + 2000, original),
  );
  const reopened = setPublishedBuddyClosed(edited, false, now + 3000);
  assert.equal(
    matchBuddyParties([reopened], { ...query, capacity: 4 }, [], now + 3000)
      .length,
    1,
  );
});
test("local publication storage roundtrips closed and expired records but rejects corrupt or duplicate records", () => {
  const party = makePublishedBuddy(draft, "local-first", now);
  assert.deepEqual(parsePublishedBuddies(serializePublishedBuddies([party])), [
    party,
  ]);
  assert.deepEqual(parsePublishedBuddies(null), []);
  for (const raw of [
    "",
    "{",
    '{"version":2,"parties":[]}',
    JSON.stringify({ version: 1, parties: [party, party] }),
    JSON.stringify({ version: 1, parties: [{ ...party, token: "private" }] }),
  ])
    assert.throws(() => parsePublishedBuddies(raw));
  assert.throws(() =>
    serializePublishedBuddies(
      Array.from({ length: 21 }, (_, n) => ({ ...party, id: "local-" + n })),
    ),
  );
});
test("date filtering does not mix undated samples or another day's published meals", () => {
  const party = makePublishedBuddy(draft, "local-first", now);
  assert.equal(
    matchBuddyParties([party], { ...query, mealDate: "2026-10-20" }, [], now)
      .length,
    0,
  );
  assert.equal(
    matchBuddyParties([party], { ...query, mealDate: "2026-10-19" }, [], now)
      .length,
    1,
  );
  const undated = { ...party, mealDate: undefined };
  assert.equal(
    matchBuddyParties([undated], { ...query, mealDate: "2026-10-19" }, [], now)
      .length,
    0,
  );
});
test("budget input rejects silent rounding, exponent input and out-of-range values", () => {
  assert.equal(parseBudgetYuan(" 25.01 "), 2501);
  for (const value of ["", "0", "1000.01", "25.001", "1e2", "-5", "NaN"])
    assert.throws(() => parseBudgetYuan(value));
});
