import test from "node:test";
import assert from "node:assert/strict";
import { retryTunnel } from "../scripts/share-tunnel-retry.mjs";

test("tunnel retries back off, cap at one minute, and stop immediately when cancelled", async () => {
  const controller = new AbortController(), delays: number[] = [];
  let attempts = 0;
  await retryTunnel({
    signal: controller.signal, now: () => 0,
    connect: async () => { attempts++; },
    onRetry: (delay: number) => delays.push(delay),
    wait: async () => { if (delays.length === 7) controller.abort(); },
  });
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.equal(attempts, 7);
});

test("a recovered tunnel resets retry delay and a stopped connection never reconnects", async () => {
  const controller = new AbortController(), delays: number[] = [];
  let clock = 0, attempts = 0;
  await retryTunnel({
    signal: controller.signal, now: () => clock,
    connect: async () => { attempts++; if (attempts === 3) clock += 120000; if (attempts === 4) controller.abort(); },
    onRetry: (delay: number) => delays.push(delay), wait: async () => {},
  });
  assert.deepEqual(delays, [5000, 10000, 5000]);
  assert.equal(attempts, 4);
});

test("an aborted retry wait does not start a new tunnel", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await retryTunnel({
    signal: controller.signal, connect: async () => { attempts++; }, onRetry: () => {},
    wait: async () => { controller.abort(); throw new Error("Aborted"); },
  });
  assert.equal(attempts, 1);
});
