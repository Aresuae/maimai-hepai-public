import test from "node:test";
import assert from "node:assert/strict";
import { menuDisplayPriceCents } from "../src/domain/menu-price.ts";
import { SharedCatalogItem } from "../src/domain/shared-table.ts";

test("menu display yuan converts to integer cents; missing or ambiguous prices never become free", () => {
  for (const [value, cents] of [["26.5", 2650], ["14.50", 1450], ["0.29", 29], ["0", 0], ["10000.00", 1000000]] as const) assert.equal(menuDisplayPriceCents(value), cents);
  for (const value of [undefined, null, "", 26.5, "¥26.5", "26元起", "1e2", "-1", "1.005", "Infinity", "10000.01", "26,5"]) assert.equal(menuDisplayPriceCents(value), undefined);
  const item = { code: "burger", name: "巨无霸", category: "mains" };
  assert.doesNotThrow(() => SharedCatalogItem.parse(item));
  for (const price of [-1, 0.5, Infinity, NaN, 1000001, "2650"]) assert.throws(() => SharedCatalogItem.parse({ ...item, menuPriceCents: price }));
  assert.equal(SharedCatalogItem.parse({ ...item, menuPriceCents: 0 }).menuPriceCents, 0);
});
