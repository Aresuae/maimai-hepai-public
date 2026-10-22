import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  makePublishedBuddy,
  parsePublishedBuddies,
  serializePublishedBuddies,
  setPublishedBuddyClosed,
  type PublishedBuddyParty,
} from "../domain/buddy-publishing.ts";

export class LocalDataError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export type PartySnapshot = { revision: number; parties: PublishedBuddyParty[] };
type AccountRow = { secret: string | null; disabled: number; revision: number; verified_at: number | null };

/** One private workspace per database. Visitor authentication/isolation is enforced by the caller. */
export class LocalDatabase {
  private db: DatabaseSync;
  private keyPath: string;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.keyPath = join(dirname(path), "credential.key");
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    const version = this.db.prepare("PRAGMA user_version").get()!.user_version as number;
    if (version > 1) { this.db.close(); throw new Error("数据库版本较新，请使用对应版本的程序。"); }
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS local_account (
          id INTEGER PRIMARY KEY CHECK(id=1), secret TEXT, disabled INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 0, verified_at INTEGER
        );
        INSERT OR IGNORE INTO local_account(id) VALUES(1);
        CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO collections VALUES('parties',0);
        CREATE TABLE IF NOT EXISTS gatherings (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
        PRAGMA user_version=1;
      `);
    });
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private account() { return this.db.prepare("SELECT secret,disabled,revision,verified_at FROM local_account WHERE id=1").get() as AccountRow; }
  private key(create: boolean) {
    if (!existsSync(this.keyPath)) {
      if (!create) throw new LocalDataError("授权密钥缺失，请重新连接麦当劳账号。", 503);
      try { writeFileSync(this.keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); }
      catch (error) { if (!existsSync(this.keyPath)) throw error; }
    }
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) throw new LocalDataError("授权密钥损坏，请恢复本机数据备份。", 503);
    return key;
  }
  status(environmentConfigured: boolean) {
    const row = this.account();
    return {
      source: row.disabled ? "none" : row.secret ? "database" : environmentConfigured ? "environment" : "none",
      revision: row.revision,
      verifiedAt: row.verified_at,
      database: "sqlite" as const,
      schemaVersion: 1,
      partyCount: this.db.prepare("SELECT count(*) AS count FROM gatherings").get()!.count as number,
      scope: "local-owner" as const,
    };
  }
  credential(environmentToken?: string) {
    const row = this.account();
    if (row.disabled) return { token: null, revision: row.revision };
    if (!row.secret) return { token: environmentToken?.trim() || null, revision: row.revision };
    try {
      const packed = Buffer.from(row.secret, "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.key(false), packed.subarray(0, 12));
      decipher.setAAD(Buffer.from("maimai-local-owner:v1"));
      decipher.setAuthTag(packed.subarray(12, 28));
      const token = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
      return { token, revision: row.revision };
    } catch { throw new LocalDataError("无法解密本机授权，请重新连接麦当劳账号。", 503); }
  }
  assertAccountRevision(revision: number) {
    if (this.account().revision !== revision) throw new LocalDataError("账号连接已变化，请刷新后重新操作。", 409);
  }
  connect(token: string, expectedRevision: number, now = Date.now()) {
    this.transaction(() => {
      this.assertAccountRevision(expectedRevision);
      const iv = randomBytes(12);
      // Never replace a missing key while an existing credential still depends on it.
      const cipher = createCipheriv("aes-256-gcm", this.key(!this.account().secret), iv);
      cipher.setAAD(Buffer.from("maimai-local-owner:v1"));
      const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
      this.db.prepare("UPDATE local_account SET secret=?, disabled=0, revision=revision+1, verified_at=? WHERE id=1").run(packed, now);
    });
  }
  disconnect(expectedRevision: number) {
    this.transaction(() => {
      this.assertAccountRevision(expectedRevision);
      // The explicit tombstone also disables the .env fallback on restart.
      this.db.prepare("UPDATE local_account SET secret=NULL, disabled=1, revision=revision+1, verified_at=NULL WHERE id=1").run();
    });
  }
  private readParties(): PartySnapshot {
    const revision = this.db.prepare("SELECT revision FROM collections WHERE name='parties'").get()!.revision as number;
    const rows = this.db.prepare("SELECT payload FROM gatherings ORDER BY updated_at DESC,id").all();
    return { revision, parties: parsePublishedBuddies(JSON.stringify({ version: 1, parties: rows.map(r => JSON.parse(r.payload as string)) })) };
  }
  parties() { return this.transaction(() => this.readParties()); }
  private writeParties(parties: PublishedBuddyParty[]) {
    const valid = parsePublishedBuddies(serializePublishedBuddies(parties));
    const write = this.db.prepare("INSERT INTO gatherings VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at");
    for (const party of valid) write.run(party.id, JSON.stringify(party), party.updatedAt);
    this.db.prepare("UPDATE collections SET revision=revision+1 WHERE name='parties'").run();
    return this.readParties();
  }
  saveParties(expectedRevision: number, incoming: PublishedBuddyParty[], now = Date.now()) {
    return this.transaction(() => {
      const current = this.readParties();
      if (current.revision !== expectedRevision) throw new LocalDataError("饭局已在其他页面修改，请刷新列表后重新编辑。", 409);
      const valid = parsePublishedBuddies(serializePublishedBuddies(incoming));
      if (current.parties.some(p => !valid.some(n => n.id === p.id))) throw new LocalDataError("不能用整表覆盖删除已有饭局。");
      const next = valid.map(p => {
        const previous = current.parties.find(old => old.id === p.id);
        if (previous && JSON.stringify(previous) === JSON.stringify(p)) return previous;
        if (previous) {
          const withoutState = (value: PublishedBuddyParty) => { const { closed, updatedAt, ...rest } = value; return JSON.stringify(rest); };
          if (withoutState(p) === withoutState(previous)) return setPublishedBuddyClosed(previous, p.closed, now);
        }
        const { id, source, occupied, closed, createdAt, updatedAt, ...draft } = p;
        const saved = makePublishedBuddy(draft, id, now, previous);
        if (previous && p.closed !== previous.closed) throw new LocalDataError("请分别保存修改和调整招募状态。");
        return saved;
      });
      return this.writeParties(next);
    });
  }
  importParties(incoming: PublishedBuddyParty[]) {
    return this.transaction(() => {
      const current = this.readParties();
      const valid = parsePublishedBuddies(serializePublishedBuddies(incoming));
      const additions = valid.filter(p => !current.parties.some(old => old.id === p.id));
      if (!additions.length) return { ...current, imported: 0 };
      return { ...this.writeParties([...current.parties, ...additions]), imported: additions.length };
    });
  }
}
