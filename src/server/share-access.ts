import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LocalDataError } from "./local-database.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
type SessionRow = { workspace: string; expires: number; origin: string };

/** Invitation grants a new, isolated workspace; it never grants the local owner's identity. */
export class ShareAccess {
  private db: DatabaseSync;
  private inviteHash: Buffer;
  constructor(directory: string, invite: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.inviteHash = digest(invite);
    this.db = new DatabaseSync(join(directory, "sessions.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, origin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  }
  close() { this.db.close(); }
  limit(key: string, maximum: number, windowMs: number, now = Date.now()) {
    this.db.prepare("DELETE FROM limits WHERE expires<=?").run(now);
    this.db.prepare(`INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, now + windowMs);
    const row = this.db.prepare("SELECT count FROM limits WHERE key=?").get(key)!;
    if (Number(row.count) > maximum) throw new LocalDataError("操作过于频繁，请稍后再试。", 429);
  }
  lookup(token: string, origin: string, now = Date.now()): SessionRow | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare("SELECT workspace,expires,origin FROM sessions WHERE hash=?").get(digest(token).toString("hex")) as SessionRow | undefined;
    return row && row.origin === origin && row.expires > now ? row : null;
  }
  login(code: string, origin: string, now = Date.now()) {
    if (!timingSafeEqual(digest(code), this.inviteHash)) throw new LocalDataError("邀请码不正确，请向发起人确认。", 403);
    return this.createVisitor(origin, now);
  }
  /** Server-only; the caller must first validate the table invitation. */
  createVisitor(origin: string, now = Date.now()) {
    // Bound on-disk workspaces as well as active visitors, including repeated logouts.
    if (Number(this.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n) >= 128)
      throw new LocalDataError("本轮内测名额已满，请联系发起人。", 429);
    const token = randomBytes(32).toString("base64url");
    const workspace = randomBytes(16).toString("hex");
    const expires = now + SESSION_SECONDS * 1000;
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest(token).toString("hex"), workspace, expires, origin);
    return { token, workspace, expires };
  }
  logout(token: string) { this.db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(digest(token).toString("hex")); }
}

export function loadInvitation(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "invitation.json");
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ code: randomBytes(18).toString("base64url") }), { flag: "wx", mode: 0o600 });
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || !("code" in value) || typeof value.code !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(value.code))
    throw new Error("邀请码文件格式有误，请检查 data/share/invitation.json。");
  return value.code;
}
