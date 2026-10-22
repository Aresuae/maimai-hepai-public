import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { parseTableInvitation, tableInvitationLink } from "../src/domain/table-invitation.ts";
import { readShareOrigin } from "../src/server/share-status.ts";

const id = "a".repeat(24), invite = "b".repeat(32), origin = "https://test.lhr.life";
test("table invitation links roundtrip and never use a local, malformed or closed destination", () => {
  const link = tableInvitationLink(origin, id, invite);
  assert.deepEqual(parseTableInvitation(new URL(link).hash), { id, invite });
  assert.equal(new URL(link).search, "");
  for (const base of ["", undefined, "http://127.0.0.1:5173", "http://test.lhr.life", "https://test.lhr.life.evil.org", `${origin}/x`, `${origin}?key=x`]) assert.equal(tableInvitationLink(base, id, invite), "");
  assert.equal(tableInvitationLink(origin, id, invite, true), "");
  assert.equal(tableInvitationLink(origin, `${id}&x=1`, invite), "");
  for (const hash of ["", `#table=${id}`, `#table=${id}&invite=short`, `#table=${id}&invite=${invite}&invite=${invite}`, `#table=${id}&table=${id}&invite=${invite}`]) assert.equal(parseTableInvitation(hash), null);
});
test("stopped or stale sharing heartbeats cannot create usable-looking invitations", t => {
  const directory = mkdtempSync(join(tmpdir(), "maimai-invite-test-"));
  t.after(() => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("maimai-invite-test-")) throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true });
  });
  const file = join(directory, "status.json"), now = Date.now();
  const save = (state: string, time = now, url = origin) => writeFileSync(file, JSON.stringify({ state, url, updatedAt: new Date(time).toISOString() }));
  assert.equal(readShareOrigin(file, now), "");
  save("正在运行"); assert.equal(readShareOrigin(file, now), origin);
  save("已停止"); assert.equal(readShareOrigin(file, now), "");
  save("正在运行", now - 46000); assert.equal(readShareOrigin(file, now), "");
  save("正在运行", now + 60000); assert.equal(readShareOrigin(file, now), "");
  save("正在运行", now, "http://127.0.0.1:5174"); assert.equal(readShareOrigin(file, now), "");
  writeFileSync(file, "partial"); assert.equal(readShareOrigin(file, now), "");
});
