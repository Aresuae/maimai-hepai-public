import type { Plugin } from "vite";
import { resolve } from "node:path";
import { readShareOrigin } from "../src/server/share-status.ts";
import { SharedTables } from "../src/server/shared-tables.ts";
import { CheckoutStore, checkoutDependencies } from "../src/server/checkout.ts";
import { LocalDatabase, LocalDataError } from "../src/server/local-database.ts";
import { localWorkspaceAction } from "../src/server/local-workspace.ts";
import {
  allowLocalMcdRequest,
  LocalMcdInput,
  localMcdAction,
  safeLocalMcdError,
} from "../src/server/local-mcd.ts";

/** Local owner only: account vault and SQLite never enter the Worker/browser build. */
export function mcdLocalApi(env: Record<string, string | undefined>): Plugin {
  let activeRequests = 0;
  return {
    name: "maimai-local-mcd-preview",
    apply: "serve",
    configureServer(server) {
      const db = new LocalDatabase(resolve("data/maimai.sqlite"));
      const tables = new SharedTables(resolve("data/shared-tables.sqlite"));
      server.httpServer?.once("close", () => { db.close(); tables.close(); });
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!["/api/mcd", "/api/local", "/api/table", "/api/checkout"].includes(path ?? "")) return next();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        const respond = (status: number, value: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(value));
        };
        if (
          !allowLocalMcdRequest(
            req.method ?? "",
            req.headers.host ?? "",
            String(req.headers.origin ?? ""),
            req.socket.remoteAddress ?? "",
            String(req.headers["content-type"] ?? ""),
          )
        )
          return respond(403, { error: "仅限本机同源网页访问个人工作区。" });
        if (activeRequests >= 2)
          return respond(429, { error: "正在读取其他请求，请稍后再试。" });
        activeRequests++;
        try {
          const limit = path !== "/api/mcd" ? 96000 : 24000;
          if (Number(req.headers["content-length"] ?? 0) > limit)
            return respond(413, { error: "餐单内容过长。" });
          let body = "";
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > limit)
              return respond(413, { error: "餐单内容过长。" });
          }
          let input;
          try {
            input = JSON.parse(body);
          } catch {
            return respond(400, { error: "请求格式不正确，请检查选餐内容。" });
          }
          if (path === "/api/table") {
            const result = tables.action(input, "local-owner");
            const publicOrigin = readShareOrigin(resolve("data/share/status.json"));
            return respond(200, { ...result, publicOrigin });
          }
          if (path === "/api/local") {
            respond(200, await localWorkspaceAction(db, input, env.MCD_MCP_TOKEN));
            return;
          }
          const credential = db.credential(env.MCD_MCP_TOKEN);
          const revision = Number(req.headers["x-maimai-account-version"]);
          if (!Number.isSafeInteger(revision) || revision !== credential.revision)
            throw new LocalDataError("账号连接已变化，请在账号面板刷新后重新选餐。", 409);
          if (!credential.token)
            return respond(401, { error: "请先在“我的麦当劳账号”中连接个人授权。" });
          if (path === "/api/checkout") {
            const checkout = new CheckoutStore(resolve("data/checkouts.sqlite"));
            try {
              const result = await checkout.action(input, credential.token, checkoutDependencies({ MCD_MCP_TOKEN: credential.token, MCD_MCP_URL: "https://mcp.mcd.cn" }, (shared, order) => {
                db.assertAccountRevision(revision);
                if (shared) {
                  return tables.checkCheckout(shared, "local-owner", order);
                }
              }, shared => tables.claimCheckout(shared, "local-owner")));
              db.assertAccountRevision(revision);
              return respond(200, result);
            } finally { checkout.close(); }
          }
          const result = await localMcdAction(LocalMcdInput.parse(input), {
            MCD_MCP_TOKEN: credential.token,
            MCD_MCP_URL: "https://mcp.mcd.cn",
          });
          db.assertAccountRevision(revision);
          respond(200, result);
        } catch (error) {
          if (error instanceof LocalDataError) return respond(error.status, { error: error.message });
          if (error && typeof error === "object" && "name" in error && error.name === "ZodError")
            return respond(400, { error: "输入格式不正确，请检查内容后重试。" });
          const safe = safeLocalMcdError(error);
          respond(502, { error: safe.message, code: safe.code });
        } finally {
          activeRequests--;
        }
      });
    },
  };
}
