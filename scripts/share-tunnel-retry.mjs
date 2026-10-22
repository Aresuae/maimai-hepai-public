import { setTimeout as sleep } from "node:timers/promises";

// Keep the local gateway alive during transient tunnel failures. An explicit stop
// cancels both the current connection and any pending retry.
export async function retryTunnel({ connect, signal, onRetry, now = Date.now, wait = (delay, signal) => sleep(delay, undefined, { signal }) }) {
  let failures = 0;
  while (!signal.aborted) {
    const started = now();
    await connect();
    if (signal.aborted) return;
    if (now() - started >= 120000) failures = 0;
    const delay = Math.min(5000 * 2 ** Math.min(failures++, 4), 60000);
    onRetry(delay);
    try { await wait(delay, signal); }
    catch (error) { if (signal.aborted) return; throw error; }
  }
}
