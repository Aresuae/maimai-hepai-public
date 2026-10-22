import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { LocalDatabase, LocalDataError } from "./local-database.ts";
import { localWorkspaceAction } from "./local-workspace.ts";
import { localMcdAction, safeLocalMcdError } from "./local-mcd.ts";
import { ShareAccess, SESSION_SECONDS } from "./share-access.ts";
import { SharedTables } from "./shared-tables.ts";
import { CheckoutStore, checkoutDependencies } from "./checkout.ts";

const AccessInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), code: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("table-login"), id: z.string().regex(/^[a-f0-9]{24}$/), invite: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict(),
  z.object({ action: z.literal("logout") }).strict(),
]);
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
};
async function readJson(req: IncomingMessage) {
  const limit = 96000;
  if (Number(req.headers["content-length"] ?? 0) > limit) throw new LocalDataError("请求内容过长。", 413);
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new LocalDataError("请求内容过长。", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new LocalDataError("请求格式不正确。", 400); }
}

/** Only serves a prebuilt client and per-visitor data. No dev-server proxy or environment token fallback. */
export function createShareServer(options: { directory: string; staticDirectory: string; invitation: string; localOrigin: string; sharedTablesPath?: string }) {
  const access = new ShareAccess(options.directory, options.invitation);
  const tables = new SharedTables(options.sharedTablesPath ?? join(options.directory, "shared-tables.sqlite"));
  const files = new Map<string, { body: Buffer; gzip: Buffer; type: string }>();
  const html = readFileSync(join(options.staticDirectory, "share.html"));
  const htmlFile = { body: html, gzip: gzipSync(html), type: "text/html; charset=utf-8" };
  for (const file of readdirSync(join(options.staticDirectory, "assets"))) {
    const type = types[extname(file)];
    if (type && /^[a-zA-Z0-9_.-]+$/.test(file)) {
      const body = readFileSync(join(options.staticDirectory, "assets", file));
      files.set(`/assets/${file}`, { body, gzip: gzipSync(body), type });
    }
  }
  let publicOrigin = "";
  let inFlight = 0;
  const activeWorkspaces = new Map<string, number>();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    const origin = [options.localOrigin, publicOrigin].find(o => o && new URL(o).host === req.headers.host);
    if (!origin || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? ""))
      return json(res, 403, { error: "访问地址未启用。" });
    if (origin.startsWith("https:") && (req.headers["x-forwarded-proto"] === "http" || req.headers["x_forwarded_proto"] === "http")) {
      res.writeHead(308, { Location: `${origin}/` }); return res.end();
    }
    const path = req.url?.split("?")[0] ?? "";
    const secure = origin.startsWith("https:");
    const cookieName = secure ? "__Host-maimai_guest" : "maimai_guest_local";
    const cookies = (req.headers.cookie ?? "").split(";").map(v => v.trim());
    const token = cookies.find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
    const session = access.lookup(token, origin);
    const cookie = (value: string, age: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
    if (req.method === "GET" && path === "/api/access") return json(res, 200, { authenticated: !!session, expiresAt: session?.expires ?? null });
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "不支持此方法。" });
      const file = path === "/" || path === "/design" ? htmlFile : files.get(path);
      if (!file) return json(res, 404, { error: "页面不存在。" });
      const compressed = /(?:^|[,\s])gzip(?:[,\s]|$)/.test(req.headers["accept-encoding"] ?? "");
      res.setHeader("Vary", "Accept-Encoding");
      if (files.has(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (compressed) res.setHeader("Content-Encoding", "gzip");
      res.writeHead(200, { "Content-Type": file.type });
      return res.end(req.method === "HEAD" ? undefined : compressed ? file.gzip : file.body);
    }
    if (!["/api/access", "/api/local", "/api/mcd", "/api/table", "/api/checkout"].includes(path)) return json(res, 404, { error: "接口不存在。" });
    if (req.method !== "POST" || req.headers.origin !== origin || (req.headers["content-type"] ?? "").split(";")[0].trim() !== "application/json")
      return json(res, 403, { error: "请从当前网页操作。" });
    if (path !== "/api/access" && !session) return json(res, 401, { code: "SHARE_LOGIN_REQUIRED", error: "请先输入邀请码进入。" });
    if (inFlight >= 12) return json(res, 429, { error: "当前访问较多，请稍后再试。" });
    inFlight++;
    let db: LocalDatabase | undefined;
    let workspaceBusy = false;
    try {
      if (path === "/api/access") {
        // Global limit cannot be bypassed by forging forwarded-IP headers.
        access.limit("access", 40, 60000);
        const input = AccessInput.parse(await readJson(req));
        if (input.action === "logout") {
          if (session) {
            db = new LocalDatabase(join(options.directory, "workspaces", session.workspace, "maimai.sqlite"));
            db.disconnect(db.status(false).revision);
          }
          access.logout(token);
          res.setHeader("Set-Cookie", cookie("", 0));
          return json(res, 200, { authenticated: false });
        }
        if (input.action === "table-login") tables.validateInvitation(input.id, input.invite, session ? `guest:${session.workspace}` : undefined);
        if (session) return json(res, 200, { authenticated: true, expiresAt: session.expires });
        const next = input.action === "table-login" ? access.createVisitor(origin) : access.login(input.code, origin);
        res.setHeader("Set-Cookie", cookie(next.token, SESSION_SECONDS));
        return json(res, 200, { authenticated: true, expiresAt: next.expires });
      }
      access.limit(`api:${session!.workspace}`, 100, 60000);
      if ((activeWorkspaces.get(session!.workspace) ?? 0) >= 2) throw new LocalDataError("正在读取其他请求，请稍后再试。", 429);
      activeWorkspaces.set(session!.workspace, (activeWorkspaces.get(session!.workspace) ?? 0) + 1);
      workspaceBusy = true;
      const input = await readJson(req);
      if (!access.lookup(token, origin)) throw new LocalDataError("访问已退出，请重新进入。", 401);
      if (path === "/api/table") return json(res, 200, { ...tables.action(input, `guest:${session!.workspace}`), publicOrigin });
      db = new LocalDatabase(join(options.directory, "workspaces", session!.workspace, "maimai.sqlite"));
      if (path === "/api/local") {
        const result = await localWorkspaceAction(db, input, undefined);
        if (!access.lookup(token, origin)) throw new LocalDataError("访问已退出，请重新进入。", 401);
        return json(res, 200, "scope" in result ? { ...result, scope: "guest" } : result);
      }
      const credential = db.credential();
      const revision = Number(req.headers["x-maimai-account-version"]);
      if (!Number.isSafeInteger(revision) || revision !== credential.revision) throw new LocalDataError("账号连接已变化，请刷新后重新选餐。", 409);
      if (!credential.token) return json(res, 401, { error: "请在右上角连接你自己的麦当劳授权，或先体验合拍演示。" });
      if (path === "/api/checkout") {
        const checkout = new CheckoutStore(join(options.directory, "workspaces", session!.workspace, "checkouts.sqlite"));
        try {
          const result = await checkout.action(input, credential.token, checkoutDependencies({ MCD_MCP_TOKEN: credential.token, MCD_MCP_URL: "https://mcp.mcd.cn" }, (shared, order) => {
            db!.assertAccountRevision(revision);
            if (!access.lookup(token, origin)) throw new LocalDataError("访问已退出，请重新进入。", 401);
            if (shared) {
              return tables.checkCheckout(shared, `guest:${session!.workspace}`, order);
            }
          }, shared => tables.claimCheckout(shared, `guest:${session!.workspace}`)));
          db.assertAccountRevision(revision);
          if (!access.lookup(token, origin)) throw new LocalDataError("访问已退出，请重新进入。", 401);
          return json(res, 200, result);
        } finally { checkout.close(); }
      }
      const result = await localMcdAction(input, { MCD_MCP_TOKEN: credential.token, MCD_MCP_URL: "https://mcp.mcd.cn" });
      db.assertAccountRevision(revision);
      if (!access.lookup(token, origin)) throw new LocalDataError("访问已退出，请重新进入。", 401);
      return json(res, 200, result);
    } catch (error) {
      if (error instanceof LocalDataError) return json(res, error.status, { error: error.message, ...(error.status === 401 ? { code: "SHARE_LOGIN_REQUIRED" } : {}) });
      if (error instanceof z.ZodError) return json(res, 400, { error: "输入格式不正确。" });
      return json(res, 502, { error: safeLocalMcdError(error).message });
    } finally {
      db?.close(); inFlight--;
      if (workspaceBusy) {
        const count = (activeWorkspaces.get(session!.workspace) ?? 1) - 1;
        if (count) activeWorkspaces.set(session!.workspace, count); else activeWorkspaces.delete(session!.workspace);
      }
    }
  });
  server.requestTimeout = 100000;
  server.headersTimeout = 15000;
  server.maxConnections = 100;
  server.once("close", () => { access.close(); tables.close(); });
  return {
    server,
    setPublicOrigin(value: string) {
      if (value && !/^https:\/\/[a-z0-9-]+\.(trycloudflare\.com|lhr\.life|localhost\.run)$/.test(value)) throw new Error("公网入口格式不正确。");
      publicOrigin = value;
    },
  };
}
