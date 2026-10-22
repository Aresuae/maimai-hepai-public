import test from "node:test";
import assert from "node:assert/strict";
import { officialProductImage } from "../src/domain/product-image.ts";
import { parseMenu, parseMealDetail } from "../src/providers/mcd-response.ts";
import { defaultConfigurationKey } from "../src/providers/mcd-quote.ts";
import { SharedCatalog } from "../src/domain/shared-table.ts";

const image = "https://menu-img.mcd.cn/pcm/prod/menu/20260309/product/MS_1100_320.png";
test("official image allowlist rejects foreign hosts, credentials and non-image URLs", () => {
  assert.equal(officialProductImage(image), image);
  for (const url of [undefined, null, 9, {}, "", "javascript:alert(1)", "data:image/png;base64,xxx",
    image.replace("https:", "http:"), image.replace("menu-img.mcd.cn", "127.0.0.1"),
    image.replace("menu-img.mcd.cn", "menu-img.mcd.cn.example.org"),
    image.replace("menu-img.mcd.cn", "user:password@menu-img.mcd.cn"),
    image.replace("menu-img.mcd.cn", "menu-img.mcd.cn:8443"),
    image.replace(".png", ".svg"), image.replace("/pcm/", "/private/"),
    `${image}?token=secret`, `${image}#secret`]) assert.equal(officialProductImage(url), undefined);
});
test("menu keeps public images while missing or malformed imagery does not break ordering data", () => {
  const result = parseMenu({ data: { categories: [], meals: {
    a: { name: "巨无霸", image, currentPrice: "26.5", withOrder: { cardId: "secret" } },
    b: { name: "缺图商品", image: null },
    c: { name: "非官方图片", image: "https://example.org/tracker.png" },
    d: { name: "旧数据" },
  } } });
  assert.equal(result.meals.a.image, image);
  assert.equal(result.meals.a.currentPrice, "26.5");
  assert.equal(result.meals.b.image, undefined);
  assert.equal(result.meals.c.image, undefined);
  assert.equal(result.meals.d.name, "旧数据");
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("detail imagery does not alter the reviewed order configuration", () => {
  const base = { code: "combo", name: "三件套", rounds: [{ id: 1, name: "主食", minQuantity: 1, maxQuantity: 1, choices: [{ code: "1100", name: "巨无霸", quantity: 1 }] }] };
  const detail = parseMealDetail({ data: { ...base, image } });
  assert.equal(detail.image, image);
  assert.equal(defaultConfigurationKey(detail), defaultConfigurationKey(parseMealDetail({ data: base })));
});
test("shared catalogs remain backward compatible and reject arbitrary shared image hosts", () => {
  const catalog = { storeCode: "123", storeName: "餐厅", items: [{ code: "1100", name: "巨无霸", category: "mains" }] };
  assert.doesNotThrow(() => SharedCatalog.parse(catalog));
  const enriched = { ...catalog, items: [{ ...catalog.items[0], image, groups: ["人气热卖"] }] };
  assert.equal(SharedCatalog.parse(enriched).items[0].image, image);
  assert.throws(() => SharedCatalog.parse({ ...enriched, items: [{ ...enriched.items[0], image: "https://example.org/track.png" }] }));
});
