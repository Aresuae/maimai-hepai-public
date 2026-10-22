import { mkdir, writeFile } from "node:fs/promises";
import { McdReadOnlyClient } from "../src/providers/mcd-readonly.ts";

const args = process.argv.slice(2);
const mode = args[0] ?? "coupons";
if (!["coupons", "stores", "menu", "quote", "combo"].includes(mode))
  throw new Error("仅支持 coupons / stores / menu / quote / combo 只读命令");
let client;
try {
  const validArgs =
    mode === "coupons"
      ? args.length <= 1
      : mode === "stores"
        ? args.length === 3
        : mode === "menu"
          ? args.length === 2
          : mode === "quote"
            ? args.length === 3 ||
              (args.length === 4 && args[3] === "--with-coupon")
            : args.length >= 4 && args.length <= 14;
  if (!validArgs)
    throw Object.assign(new Error("MCD_CLI_ARGUMENTS"), {
      code: "MCD_CLI_ARGUMENTS",
    });
  client = await McdReadOnlyClient.connect();
  let report;
  if (mode === "coupons") {
    const page = await client.accountCoupons();
    report = {
      operation: "query-my-coupons",
      source: "live",
      totalCount: page.totalCount,
      currentPage: page.currentPage,
      totalPages: page.totalPages,
      returnedCount: page.coupons.length,
      coupons: page.coupons,
      note: "账户券资产视图，不代表当前门店可用；已去掉券码与 ID。",
    };
  } else if (mode === "stores") {
    report = {
      operation: "query-nearby-stores",
      source: "live",
      dining: "pickup",
      stores: await client.searchPickupStores(args[1], args[2]),
    };
  } else if (mode === "menu") {
    const storeCode = args[1];
    const coupons = await client.storeCoupons(storeCode);
    const menu = await client.menu(storeCode);
    report = {
      operation: "query-store-coupons + query-meals",
      source: "live",
      storeCode,
      coupons: coupons.map(({ ref, ...c }) => c),
      menu,
      note: "菜单展示价的单位尚未独立校验，最终应付使用 calculate-price 的整数分。会员状态未推断。",
    };
  } else if (mode === "combo") {
    // First product uses one existing store coupon; remaining products use no coupon.
    const storeCode = args[1],
      productCodes = args.slice(2);
    if (
      productCodes.length < 2 ||
      productCodes.length > 12 ||
      productCodes.some((code) => code.startsWith("--"))
    )
      throw new Error("COMBO_INPUT_INVALID");
    const coupons = await client.storeCoupons(storeCode);
    const matching = coupons.filter((c) =>
      c.products.some((p) => p.productCode === productCodes[0]),
    );
    if (matching.length !== 1) throw new Error("COUPON_SELECTION_AMBIGUOUS");
    report = {
      operation: "query-store-coupons + query-meal-detail + calculate-price",
      ...(await client.quoteDefaults(
        storeCode,
        productCodes.map((productCode, index) => ({
          productCode,
          ...(index === 0 ? { couponRef: matching[0].ref } : {}),
        })),
      )),
      note: "券商品与单点在同一请求中按官方默认选配核价，每项一份；只证明此上下文此次组合，不代表任意券叠加。未建单或购买权益卡。",
    };
  } else {
    const storeCode = args[1],
      productCode = args[2];
    let couponRef;
    if (args[3] === "--with-coupon") {
      const coupons = await client.storeCoupons(storeCode);
      const matching = coupons.filter((c) =>
        c.products.some((p) => p.productCode === productCode),
      );
      if (matching.length !== 1) throw new Error("COUPON_SELECTION_AMBIGUOUS");
      couponRef = matching[0].ref;
    }
    report = {
      operation: "query-meal-detail + calculate-price",
      ...(await client.quoteDefault(storeCode, productCode, couponRef)),
      couponSelected: !!couponRef,
      note: "仅测试官方默认选配的报价；未建单、未领券、未兑换或购买权益卡。",
    };
  }
  const directory = new URL("../artifacts/mcp/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL(`${mode}-report.json`, directory),
    JSON.stringify(
      { ok: true, checkedAt: new Date().toISOString(), ...report },
      null,
      2,
    ),
    "utf8",
  );
  // Deliberately avoid printing whole account data or coupon credentials.
  console.log(
    JSON.stringify({
      ok: true,
      mode,
      report: `artifacts/mcp/${mode}-report.json`,
      ...(mode === "coupons"
        ? { totalCount: report.totalCount, returnedCount: report.returnedCount }
        : {}),
      ...(mode === "stores" ? { count: report.stores.length } : {}),
      ...(mode === "menu"
        ? {
            couponCount: report.coupons.length,
            mealCount: Object.keys(report.menu.meals).length,
          }
        : {}),
      ...(mode === "quote"
        ? {
            name: report.name,
            payableCents: report.quote.price,
            couponSelected: report.couponSelected,
          }
        : {}),
      ...(mode === "combo"
        ? {
            names: report.selections.map((s) => s.name),
            payableCents: report.quote.price,
          }
        : {}),
    }),
  );
} catch (error) {
  const safe =
    typeof error?.code === "string" && /^MCD_[A-Z_0-9]+$/.test(error.code)
      ? error.code
      : error?.name === "ZodError"
        ? "MCD_RESPONSE_SCHEMA_MISMATCH"
        : "MCD_READ_CHECK_FAILED";
  // Replace the latest report on failure so a previous successful quote cannot
  // be mistaken for the result of this run. Historical copies remain separate.
  const directory = new URL("../artifacts/mcp/", import.meta.url);
  await mkdir(directory, { recursive: true })
    .then(() =>
      writeFile(
        new URL(`${mode}-report.json`, directory),
        JSON.stringify(
          { ok: false, checkedAt: new Date().toISOString(), mode, code: safe },
          null,
          2,
        ),
        "utf8",
      ),
    )
    .catch(() => {});
  console.error(
    JSON.stringify({
      ok: false,
      code: safe,
      note: "未输出原始响应或凭证，未执行业务写操作。",
    }),
  );
  if (error?.name === "ZodError")
    console.error(
      JSON.stringify({
        fields: error.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
        })),
      }),
    );
  process.exitCode = 1;
} finally {
  await client?.close();
}
