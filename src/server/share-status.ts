import { readFileSync } from "node:fs";
import { sharedPublicOrigin } from "../domain/table-invitation.ts";

/** A crashed launcher must not leave a permanently usable-looking invitation. */
export function readShareOrigin(path: string, now = Date.now()): string {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const age = now - Date.parse(value.updatedAt);
    return value.state === "正在运行" && age >= -5000 && age < 45000 ? sharedPublicOrigin(value.url) : "";
  } catch { return ""; }
}
