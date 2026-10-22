import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMeal,
  indexMenuCategories,
  matchesMenuFilter,
  orderedMenuEntries,
  indexOfficialGroups,
  officialCategoryOptions,
  matchesMenuSearch,
} from "../src/domain/menu-categories.ts";

test("official navigation keeps source names and order with deduplicated counts", () => {
  const items = [
    { code: "a", name: "双人餐", groups: ["人气热卖", "小食拼盘\n/多人餐", "人气热卖"] },
    { code: "b", name: "鸡肉堡套餐", groups: ["精选单人餐", "人气热卖"] },
    { code: "c", name: "未分组新品" },
  ];
  assert.deepEqual(officialCategoryOptions(items, ["人气热卖", "精选单人餐", "小食拼盘\n/多人餐", "未返回餐品的分类"]), [
    { value: "", label: "全部餐品", count: 3 },
    { value: "人气热卖", label: "人气热卖", count: 2 },
    { value: "精选单人餐", label: "精选单人餐", count: 1 },
    { value: "小食拼盘\n/多人餐", label: "小食拼盘 /多人餐", count: 1 },
  ]);
  assert.deepEqual(items.filter(i => i.groups?.includes("精选单人餐") && matchesMenuSearch(i.name, "鸡肉 套餐")).map(i => i.code), ["b"]);
  assert.deepEqual(items.filter(i => i.groups?.includes("小食拼盘\n/多人餐") && matchesMenuSearch(i.name, "鸡肉")).map(i => i.code), []);
});

test("legacy shared menus keep every product accessible without guessed categories", () => {
  assert.deepEqual(officialCategoryOptions([{ code: "a" }, { code: "a", groups: [] }, { code: "b", groups: [" "] }]), [
    { value: "", label: "全部餐品", count: 2 },
  ]);
  assert.deepEqual(officialCategoryOptions([]), [{ value: "", label: "全部餐品", count: 0 }]);
});

test("official groups preserve combo-first order, deduplicate and intersect search", () => {
  const menu = { categories: [
    { name: "人气热卖", meals: [{ code: "9000" }, { code: "1100" }] },
    { name: "精选单人餐", meals: [{ code: "9000" }, { code: "missing" }, { code: "9001" }] },
  ], meals: { "1100": { name: "巨无霸" }, "9000": { name: "巨无霸三件套" }, "9001": { name: "麦辣鸡腿堡三件套" }, "1000": { name: "未分组新品" } } };
  assert.deepEqual(orderedMenuEntries(menu).map(([code]) => code), ["9000", "1100", "9001", "1000"]);
  const selected = orderedMenuEntries(menu, "精选单人餐");
  assert.deepEqual(selected.map(([code]) => code), ["9000", "9001"]);
  assert.deepEqual(selected.filter(([, item]) => matchesMenuFilter(item.name, "mains", "all", "巨无霸")).map(([code]) => code), ["9000"]);
  assert.deepEqual(orderedMenuEntries(menu, "不存在的分类"), []);
  assert.deepEqual(indexOfficialGroups(menu)["9000"], ["人气热卖", "精选单人餐"]);
});

test("familiar menu categories distinguish mains, sides, cold drinks and ice cream", () => {
  for (const [name, category] of [
    ["巨无霸套餐", "mains"],
    ["麦辣鸡腿堡", "mains"],
    ["猪柳蛋麦满分三件套", "mains"],
    ["双层吉士汉堡", "mains"],
    ["脆薯饼", "snacks"],
    ["麦乐鸡5块", "snacks"],
    ["菠萝派", "snacks"],
    ["冰美式中杯", "drinks"],
    ["鲜萃冰咖", "drinks"],
    ["零度可口可乐", "drinks"],
    ["奥利奥麦旋风", "icecream"],
    ["朱古力新地", "icecream"],
    ["原味圆筒冰淇淋", "icecream"],
    ["联名购物袋", "other"],
    ["薯条脆卜卜毛绒周边", "other"],
    ["德式图林根香肠", "snacks"],
    ["派", "snacks"],
  ])
    assert.equal(classifyMeal(name), category, name);
});

test("overlapping official promotional categories neither duplicate nor hide products", () => {
  const indexed = indexMenuCategories({
    categories: [
      { name: "人气热卖", meals: [{ code: "a" }, { code: "b" }] },
      { name: "麦咖啡™", meals: [{ code: "b" }] },
      { name: "小食甜品/其他", meals: [{ code: "c" }, { code: "d" }] },
    ],
    meals: {
      a: { name: "麦满分配冰咖套餐" },
      b: { name: "限定现磨" },
      c: { name: "麦旋风" },
      d: { name: "纪念品" },
      e: { name: "未分类新品" },
    },
  });
  assert.deepEqual(indexed, {
    a: "mains",
    b: "drinks",
    c: "icecream",
    d: "other",
    e: "other",
  });
});

test("search intersects the selected category and can be reused unchanged under all", () => {
  assert.equal(
    matchesMenuFilter("鲜萃冰咖", "drinks", "drinks", " 冰咖 "),
    true,
  );
  assert.equal(
    matchesMenuFilter("鲜萃冰咖", "drinks", "mains", " 冰咖 "),
    false,
  );
  assert.equal(matchesMenuFilter("鲜萃冰咖", "drinks", "all", " 冰咖 "), true);
  assert.equal(
    matchesMenuFilter("鲜萃冰咖", "drinks", "drinks", "薯饼"),
    false,
  );
  assert.equal(
    matchesMenuFilter("McCafé 冰拿铁", "drinks", "drinks", "mccafé 拿铁"),
    true,
  );
  assert.equal(matchesMenuFilter("未知新品", "other", "all", "  "), true);
});
