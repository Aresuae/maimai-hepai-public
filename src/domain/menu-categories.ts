export const MENU_CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "mains", label: "主食" },
  { id: "snacks", label: "小食" },
  { id: "drinks", label: "饮品" },
  { id: "icecream", label: "冰淇淋" },
  { id: "other", label: "其他" },
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number]["id"];
type Menu = {
  categories: { name: string; meals: { code: string }[] }[];
  meals: Record<string, { name: string }>;
};

/** Use the official category order, not numeric product-code object order.
 * Promotional groups overlap; show each product only once and retain ungrouped items. */
export function orderedMenuEntries<T extends { name: string }>(menu: {
  categories: Menu["categories"]; meals: Record<string, T>;
}, group = ""): [string, T][] {
  const codes = new Set(menu.categories.filter(c => !group || c.name === group)
    .flatMap(c => c.meals.map(m => m.code)));
  if (!group) Object.keys(menu.meals).forEach(code => codes.add(code));
  return [...codes].filter(code => Object.hasOwn(menu.meals, code)).map(code => [code, menu.meals[code]]);
}

export function indexOfficialGroups(menu: Menu): Record<string, string[]> {
  const groups = new Map<string, Set<string>>();
  for (const category of menu.categories) for (const meal of category.meals) {
    const names = groups.get(meal.code) ?? new Set<string>();
    names.add(category.name); groups.set(meal.code, names);
  }
  return Object.fromEntries([...groups].map(([code, names]) => [code, [...names]]));
}

/** Count actual products in each official group, including overlapping promotions.
 * Older shared menus may omit groups; those products remain accessible under All. */
export function officialCategoryOptions(
  items: { code: string; groups?: string[] }[],
  officialOrder: string[] = [],
) {
  const members = new Map<string, Set<string>>();
  for (const item of items) for (const group of item.groups ?? []) {
    if (!group.trim()) continue;
    const codes = members.get(group) ?? new Set<string>();
    codes.add(item.code); members.set(group, codes);
  }
  const order = [...new Set([...officialOrder, ...members.keys()])];
  return [
    { value: "", label: "全部餐品", count: new Set(items.map(i => i.code)).size },
    ...order.filter(name => members.has(name)).map(name => ({
      value: name, label: name.replace(/\s+/g, " ").trim(), count: members.get(name)!.size,
    })),
  ];
}

export function matchesMenuSearch(name: string, search: string) {
  const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, "");
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.every(term => normalizedName.includes(term));
}

/** Navigation groups only. Official names and product codes remain unchanged.
 * Specific names take precedence over overlapping promotional categories. */
export function classifyMeal(
  name: string,
  officialCategories: string[] = [],
): Exclude<MenuCategory, "all"> {
  if (/周边|毛绒|玩具|购物袋|保温杯|钥匙扣/.test(name)) return "other";
  if (
    /汉堡|巨无霸|板烧|麦满分|扒堡|蛋堡|腿堡|鱼堡|肉堡|双吉|麦香鱼|麦香鸡|营养卷|鸡肉卷|饭碗|米饭|早餐卷/.test(
      name,
    )
  )
    return "mains";
  if (/冰淇淋|麦旋风|新地|甜筒|圆筒|圣代/.test(name)) return "icecream";
  if (
    /薯条|薯饼|麦乐鸡|鸡块|鸡翅|鸡柳|麦麦脆汁鸡|油条|玉米|香肠|苹果派|菠萝派|香芋派|红豆派|派$|蛋糕|麦芬/.test(
      name,
    )
  )
    return "snacks";
  if (
    /咖啡|冰咖|热咖|美式|拿铁|奶铁|卡布奇诺|可乐|雪碧|红茶|奶茶|牛奶|豆浆|果汁|橙汁|苹果汁|柠檬茶|柠檬水|怡泉|热巧|冰巧|纯净水|矿泉水/.test(
      name,
    )
  )
    return "drinks";
  const hints = officialCategories.join(" ");
  if (/汉堡|主食|麦满分|炒双蛋堡|营养卷/.test(hints)) return "mains";
  if (/冰淇淋|麦旋风|新地/.test(hints)) return "icecream";
  if (/饮品|咖啡|现磨/.test(hints)) return "drinks";
  // Mixed "小食甜品/其他" categories can contain merchandise; don't guess.
  if (/小食|炸鸡/.test(hints) && !/其他/.test(hints)) return "snacks";
  return "other";
}

export function indexMenuCategories(menu: Menu) {
  const hints = new Map<string, string[]>();
  for (const category of menu.categories) {
    for (const meal of category.meals) {
      const names = hints.get(meal.code) ?? [];
      names.push(category.name);
      hints.set(meal.code, names);
    }
  }
  return Object.fromEntries(
    Object.entries(menu.meals).map(([code, meal]) => [
      code,
      classifyMeal(meal.name, hints.get(code)),
    ]),
  );
}

export function matchesMenuFilter(
  name: string,
  productCategory: MenuCategory,
  selectedCategory: MenuCategory,
  search: string,
) {
  return (
    (selectedCategory === "all" || selectedCategory === productCategory) &&
    matchesMenuSearch(name, search)
  );
}
