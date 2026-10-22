import type { Member, MenuItem } from "../domain/types.ts";

// Invented names and prices. Never describe these as an official menu or quote.
export const DEMO_MENU: MenuItem[] = [
  {
    id: "demo-chicken",
    name: "鸡肉堡（示例）",
    kind: "main",
    main: "chicken",
    priceCents: 1400,
  },
  {
    id: "demo-beef",
    name: "牛肉堡（示例）",
    kind: "main",
    main: "beef",
    priceCents: 1600,
  },
  {
    id: "demo-fish",
    name: "鱼排堡（示例）",
    kind: "main",
    main: "fish",
    priceCents: 1500,
  },
  {
    id: "demo-cola",
    name: "可乐（示例）",
    kind: "drink",
    drink: "cola",
    priceCents: 500,
  },
  {
    id: "demo-coffee",
    name: "咖啡（示例）",
    kind: "drink",
    drink: "coffee",
    priceCents: 800,
  },
  { id: "demo-fries", name: "个人薯条（示例）", kind: "side", priceCents: 700 },
  {
    id: "demo-sharing",
    name: "分享薯条（示例）",
    kind: "side",
    shared: true,
    priceCents: 1200,
  },
];

export const DEMO_MEMBERS: Member[] = [
  {
    id: "a",
    name: "小麦",
    color: "tomato",
    preferences: {
      budgetCents: 3000,
      main: "chicken",
      drink: "cola",
      fries: "must",
      acceptsSharing: false,
    },
  },
  {
    id: "b",
    name: "阿橙",
    color: "orange",
    preferences: {
      budgetCents: 3500,
      main: "beef",
      drink: "coffee",
      fries: "nice",
      acceptsSharing: true,
    },
  },
  {
    id: "c",
    name: "小鱼",
    color: "blue",
    preferences: {
      budgetCents: 3000,
      main: "fish",
      drink: "cola",
      fries: "nice",
      acceptsSharing: true,
    },
  },
  {
    id: "d",
    name: "可可",
    color: "green",
    preferences: {
      budgetCents: 2500,
      main: "chicken",
      drink: "none",
      fries: "nice",
      acceptsSharing: true,
    },
  },
];
