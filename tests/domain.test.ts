import test from "node:test";
import assert from "node:assert/strict";
import { allocateCents } from "../src/domain/money.ts";
import { buildDemoPlans, allocateCart } from "../src/domain/planner.ts";
import {
  confirmPlan,
  createDemoRoom,
  proposePlans,
  revokeConfirmation,
  selectPlan,
  updatePreference,
  replaceRoster,
  updatePayment,
} from "../src/domain/room.ts";
import { DEMO_MEMBERS, DEMO_MENU } from "../src/providers/demo.ts";
import { makeRoster } from "../src/domain/members.ts";
import {
  adoptVote,
  castVote,
  startVote,
  voteSummary,
} from "../src/domain/voting.ts";
import { chooseRandomMain } from "../src/domain/random-choice.ts";
import {
  makeBuddyGroup,
  parseBuddyGroups,
  serializeBuddyGroups,
} from "../src/domain/buddies.ts";
import { buildReceipt, receiptSvg } from "../src/domain/receipt.ts";

const timestamp = 1000;
function withPlans() {
  const room = createDemoRoom(DEMO_MEMBERS);
  return proposePlans(
    room,
    buildDemoPlans(room.members, DEMO_MENU, room.revision, timestamp).plans,
  );
}

test("allocation conserves cents and ties do not depend on input order", () => {
  assert.deepEqual(
    allocateCents(100, [
      { id: "b", weight: 1 },
      { id: "a", weight: 1 },
      { id: "c", weight: 1 },
    ]),
    { a: 34, b: 33, c: 33 },
  );
  for (let amount = 0; amount < 300; amount++) {
    const amounts = allocateCents(amount, [
      { id: "a", weight: 3 },
      { id: "b", weight: 7 },
      { id: "c", weight: 2 },
    ]);
    assert.equal(
      Object.values(amounts).reduce((a, b) => a + b, 0),
      amount,
    );
    assert.ok(
      Object.values(amounts).every(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    );
  }
});

test("invalid monetary input, duplicate members and zero weights are rejected", () => {
  for (const amount of [-1, NaN, Infinity, 1.1])
    assert.throws(() => allocateCents(amount, [{ id: "a", weight: 1 }]));
  assert.throws(() => allocateCents(10, []));
  assert.throws(() => allocateCents(10, [{ id: "a", weight: 0 }]));
  assert.throws(() =>
    allocateCents(10, [
      { id: "a", weight: 1 },
      { id: "a", weight: 2 },
    ]),
  );
});

test("every suggested plan satisfies budgets, required items and exact totals", () => {
  const { plans, conflicts } = buildDemoPlans(
    DEMO_MEMBERS,
    DEMO_MENU,
    1,
    timestamp,
  );
  assert.equal(conflicts.length, 0);
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    assert.equal(plan.quote.source, "demo");
    const cartTotal = plan.lines.reduce(
      (sum, line) =>
        sum +
        DEMO_MENU.find((i) => i.id === line.itemId)!.priceCents * line.quantity,
      0,
    );
    assert.equal(plan.quote.totalCents, cartTotal);
    assert.equal(
      plan.allocations.reduce((sum, a) => sum + a.totalCents, 0),
      cartTotal,
    );
    for (const member of DEMO_MEMBERS) {
      const allocation = plan.allocations.find(
        (a) => a.memberId === member.id,
      )!;
      assert.ok(allocation.totalCents <= member.preferences.budgetCents);
      assert.ok(
        plan.lines.some(
          (l) =>
            l.memberIds.includes(member.id) &&
            DEMO_MENU.find((i) => i.id === l.itemId)?.main ===
              member.preferences.main,
        ),
      );
      if (member.preferences.fries === "must")
        assert.ok(
          plan.lines.some(
            (l) =>
              l.itemId === "demo-fries" &&
              l.memberIds.length === 1 &&
              l.memberIds[0] === member.id,
          ),
        );
    }
  }
});

test("infeasible budget returns an explanation without relaxing the budget", () => {
  const members = structuredClone(DEMO_MEMBERS);
  members[0].preferences.budgetCents = 1000;
  const result = buildDemoPlans(members, DEMO_MENU, 1, timestamp);
  assert.equal(result.plans.length, 0);
  assert.match(result.conflicts[0], /小麦.*超出预算/);
  assert.equal(members[0].preferences.budgetCents, 1000);
});

test("missing required menu items are not fabricated", () => {
  const result = buildDemoPlans(
    DEMO_MEMBERS,
    DEMO_MENU.filter((i) => i.main !== "chicken"),
    1,
    timestamp,
  );
  assert.equal(result.plans.length, 0);
  assert.match(result.conflicts[0], /不可用/);
});

test("optional wishes and shared food never bypass consent or budget", () => {
  const members = structuredClone(DEMO_MEMBERS);
  members[1].preferences.acceptsSharing = false;
  members[2].preferences.budgetCents = 2000;
  const result = buildDemoPlans(members, DEMO_MENU, 1, timestamp);
  for (const plan of result.plans)
    for (const line of plan.lines.filter((l) => l.memberIds.length > 1)) {
      assert.ok(!line.memberIds.includes("b"));
      assert.ok(!line.memberIds.includes("c"));
    }
  for (const plan of result.plans)
    assert.ok(
      plan.allocations.find((a) => a.memberId === "c")!.totalCents <= 2000,
    );
});

test("identical candidate carts are deduplicated", () => {
  const members = structuredClone(DEMO_MEMBERS);
  for (const m of members) m.preferences.fries = "no";
  assert.equal(
    buildDemoPlans(members, DEMO_MENU, 1, timestamp).plans.length,
    1,
  );
});

test("unknown or duplicate item owners cannot create an unbalanced bill", () => {
  assert.throws(() =>
    allocateCart(
      [{ itemId: "demo-fries", quantity: 1, memberIds: ["unknown"] }],
      DEMO_MEMBERS,
      DEMO_MENU,
    ),
  );
  assert.throws(() =>
    allocateCart(
      [{ itemId: "demo-fries", quantity: 1, memberIds: ["a", "a"] }],
      DEMO_MEMBERS,
      DEMO_MENU,
    ),
  );
});

test("editing a preference invalidates all proposals and confirmations", () => {
  const room = confirmPlan(withPlans(), "a", 1, timestamp);
  const changed = updatePreference(room, "b", { drink: "none" });
  assert.equal(changed.revision, room.revision + 1);
  assert.deepEqual(changed.confirmations, {});
  assert.equal(changed.plans.length, 0);
  assert.equal(changed.phase, "collecting");
  assert.throws(() => proposePlans(changed, room.plans), /过时/);
});

test("switching proposals invalidates confirmations and stale version is rejected", () => {
  const room = confirmPlan(withPlans(), "a", 1, timestamp);
  const changed = selectPlan(room, "wish", timestamp);
  assert.equal(changed.proposalVersion, 2);
  assert.deepEqual(changed.confirmations, {});
  assert.throws(() => confirmPlan(changed, "b", 1, timestamp), /变更/);
});

test("all current members must confirm, repeated confirmation is idempotent, revocation reopens", () => {
  let room = withPlans();
  for (const member of room.members)
    room = confirmPlan(room, member.id, room.proposalVersion, timestamp);
  assert.equal(room.phase, "confirmed");
  room = confirmPlan(room, "a", room.proposalVersion, timestamp);
  assert.equal(Object.keys(room.confirmations).length, 4);
  assert.equal(revokeConfirmation(room, "a").phase, "reviewing");
  assert.throws(
    () => confirmPlan(room, "intruder", room.proposalVersion, timestamp),
    /不存在/,
  );
});

test("expired quote cannot be selected or confirmed", () => {
  const room = withPlans();
  assert.throws(
    () => confirmPlan(room, "a", room.proposalVersion, timestamp + 300000),
    /过期/,
  );
  assert.throws(() => selectPlan(room, "wish", timestamp + 300000), /过期/);
});

test("variable 2 to 6 member tables require every current member to confirm", () => {
  for (const count of [2, 3, 5, 6]) {
    const members = makeRoster(
      Array.from({ length: count }, (_, i) => `成员${i + 1}`),
    );
    let room = createDemoRoom(members);
    room = proposePlans(
      room,
      buildDemoPlans(members, DEMO_MENU, room.revision, timestamp).plans,
    );
    for (const member of members.slice(0, -1))
      room = confirmPlan(room, member.id, room.proposalVersion, timestamp);
    assert.equal(room.phase, "reviewing");
    room = confirmPlan(
      room,
      members.at(-1)!.id,
      room.proposalVersion,
      timestamp,
    );
    assert.equal(room.phase, "confirmed");
    assert.equal(buildReceipt(room, timestamp).people, count);
  }
  assert.throws(() => makeRoster(["只有一个"]));
  assert.throws(() => makeRoster(["同名", "同名"]));
  assert.throws(() => makeRoster(["正常", " "]));
  assert.throws(() =>
    makeRoster(Array.from({ length: 7 }, (_, i) => `成员${i}`)),
  );
});

test("treat mode preserves meals, assigns all payable cents to one payer and caps total", () => {
  const members = structuredClone(DEMO_MEMBERS);
  members.forEach((m) => (m.preferences.budgetCents = 100));
  const payment = {
    mode: "treat",
    payerId: "b",
    totalBudgetCents: 9600,
  } as const;
  const { plans, conflicts } = buildDemoPlans(
    members,
    DEMO_MENU,
    1,
    timestamp,
    payment,
  );
  assert.deepEqual(conflicts, []);
  assert.ok(plans.length > 0);
  for (const p of plans) {
    assert.ok(p.quote.totalCents <= payment.totalBudgetCents);
    assert.equal(
      p.allocations.reduce((sum, a) => sum + a.payableCents, 0),
      p.quote.totalCents,
    );
    assert.equal(
      p.allocations.reduce((sum, a) => sum + a.totalCents, 0),
      p.quote.totalCents,
    );
    assert.equal(
      p.allocations.find((a) => a.memberId === "b")!.payableCents,
      p.quote.totalCents,
    );
    assert.ok(
      p.allocations
        .filter((a) => a.memberId !== "b")
        .every((a) => a.payableCents === 0 && a.items.length > 0),
    );
  }
  const failed = buildDemoPlans(members, DEMO_MENU, 1, timestamp, {
    ...payment,
    totalBudgetCents: 1000,
  });
  assert.equal(failed.plans.length, 0);
  assert.match(failed.conflicts[0], /整桌.*超出请客预算/);
  assert.throws(() =>
    buildDemoPlans(members, DEMO_MENU, 1, timestamp, {
      ...payment,
      payerId: "missing",
    }),
  );
});

test("payment and roster changes clear ballots and confirmations; loaded groups never inherit a payer", () => {
  let room = castVote(
    startVote(withPlans(), timestamp),
    "a",
    "simple",
    2,
    timestamp,
  );
  const paymentChanged = updatePayment(room, {
    mode: "treat",
    payerId: "b",
    totalBudgetCents: 12000,
  });
  assert.deepEqual(paymentChanged.vote.ballots, {});
  assert.equal(paymentChanged.plans.length, 0);
  assert.throws(() => proposePlans(paymentChanged, room.plans), /过时/);
  room = replaceRoster(paymentChanged, makeRoster(["新朋友", "旧朋友"]));
  assert.deepEqual(room.payment, { mode: "split" });
  assert.deepEqual(room.confirmations, {});
  assert.equal(room.members.length, 2);
});

test("anonymous vote shows no partial totals, accepts only one ballot per member and locks after reveal", () => {
  let room = startVote(withPlans(), timestamp);
  const round = room.vote.round;
  room = castVote(room, "a", "simple", round, timestamp);
  room = castVote(room, "a", "wish", round, timestamp);
  assert.equal(voteSummary(room).submitted, 1);
  assert.deepEqual(voteSummary(room).counts, []);
  assert.throws(
    () => confirmPlan(room, "a", room.proposalVersion, timestamp),
    /投票/,
  );
  assert.throws(
    () => castVote(room, "a", "wish", round - 1, timestamp),
    /变更/,
  );
  assert.throws(
    () => castVote(room, "intruder", "wish", round, timestamp),
    /不存在/,
  );
  for (const member of ["b", "c", "d"])
    room = castVote(room, member, "wish", round, timestamp);
  assert.equal(room.vote.phase, "closed");
  assert.deepEqual(voteSummary(room).winnerIds, ["wish"]);
  assert.equal(
    voteSummary(room).counts.find((c) => c.planId === "wish")!.count,
    4,
  );
  assert.throws(() => castVote(room, "a", "simple", round, timestamp), /结束/);
  assert.throws(() => adoptVote(room, "simple", timestamp), /得票最多/);
  room = adoptVote(room, "wish", timestamp);
  assert.equal(room.selectedPlanId, "wish");
  assert.deepEqual(room.confirmations, {});
  assert.equal(room.phase, "reviewing");
});

test("ties require explicit choice among leaders and stale votes cannot survive edits", () => {
  let room = startVote(withPlans(), timestamp);
  for (const [i, member] of room.members.entries())
    room = castVote(
      room,
      member.id,
      i % 2 ? "wish" : "simple",
      room.vote.round,
      timestamp,
    );
  assert.deepEqual(voteSummary(room).winnerIds.sort(), ["simple", "wish"]);
  assert.throws(() => adoptVote(room, "sharing", timestamp));
  assert.throws(() => adoptVote(room, "simple", timestamp + 300000), /过期/);
  room = adoptVote(room, "simple", timestamp);
  assert.equal(room.phase, "reviewing");
  const changed = updatePreference(room, "a", { drink: "none" });
  assert.deepEqual(changed.vote.ballots, {});
  assert.throws(() =>
    castVote(changed, "a", "simple", room.vote.round, timestamp),
  );
});

test("random main respects exclusions and whole meal affordability, without altering other wishes", () => {
  let room = createDemoRoom(DEMO_MEMBERS);
  room = updatePreference(room, "a", {
    excludedMains: ["beef"],
    budgetCents: 2600,
  });
  const before = structuredClone(room);
  for (const random of [0, 0.3, 0.7, 0.999])
    assert.equal(
      chooseRandomMain(room, "a", DEMO_MENU, random, timestamp),
      "chicken",
    );
  assert.deepEqual(room, before);
  room = updatePreference(room, "a", { budgetCents: 1000 });
  assert.throws(
    () => chooseRandomMain(room, "a", DEMO_MENU, 0, timestamp),
    /预算/,
  );
  room = updatePayment(room, {
    mode: "treat",
    payerId: "b",
    totalBudgetCents: 8400,
  });
  assert.equal(
    chooseRandomMain(room, "a", DEMO_MENU, 0.99, timestamp),
    "chicken",
  );
  assert.throws(() =>
    updatePreference(room, "a", { excludedMains: ["chicken", "beef", "fish"] }),
  );
});

test("buddy storage roundtrips only whitelisted preferences and rejects incompatible or malformed data", () => {
  const group = makeBuddyGroup("team-1", "工作日小队", DEMO_MEMBERS);
  const raw = serializeBuddyGroups([group]);
  assert.deepEqual(parseBuddyGroups(raw), [group]);
  assert.deepEqual(parseBuddyGroups(null), []);
  assert.throws(() => parseBuddyGroups('{"version":2,"groups":[]}'));
  assert.throws(() => parseBuddyGroups("broken"));
  assert.throws(() => serializeBuddyGroups([group, group]));
  const injected = JSON.parse(raw);
  injected.groups[0].token = "DO_NOT_SAVE";
  injected.groups[0].members[0].preferences.credential = "DO_NOT_SAVE";
  assert.ok(
    !serializeBuddyGroups(parseBuddyGroups(JSON.stringify(injected))).includes(
      "DO_NOT_SAVE",
    ),
  );
  injected.groups[0].members[0].preferences.main = "unknown";
  assert.throws(() => parseBuddyGroups(JSON.stringify(injected)));
});

test("receipt requires unexpired unanimous confirmation and escapes SVG text", () => {
  let room = withPlans();
  assert.throws(() => buildReceipt(room, timestamp), /全员确认/);
  for (const m of room.members)
    room = confirmPlan(room, m.id, room.proposalVersion, timestamp);
  const receipt = buildReceipt(room, timestamp);
  assert.match(receipt.text, /非付款凭证/);
  assert.match(receipt.highlights[0], /2 人同选鸡肉堡/);
  assert.throws(
    () => buildReceipt(revokeConfirmation(room, "a"), timestamp),
    /全员确认/,
  );
  assert.throws(() => buildReceipt(room, timestamp + 300000), /过期/);
  receipt.rows[0].name = '<script>&"';
  const svg = receiptSvg(receipt);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;&amp;&quot;"));
});
