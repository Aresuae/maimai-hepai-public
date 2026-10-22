import type { RoomState } from "./types.ts";
import { formatMoney } from "./money.ts";

export function buildReceipt(room: RoomState, now = Date.now()) {
  const plan = room.plans.find((p) => p.id === room.selectedPlanId);
  if (
    !plan ||
    room.phase !== "confirmed" ||
    plan.roomRevision !== room.revision ||
    !room.members.every(
      (m) => room.confirmations[m.id] === room.proposalVersion,
    )
  )
    throw new Error("全员确认当前餐单后，才能生成默契小票");
  if (plan.quote.expiresAt <= now)
    throw new Error("演示报价已过期，请重新生成并确认");
  const mainNames = { chicken: "鸡肉堡", beef: "牛肉堡", fish: "鱼排堡" };
  const mainCounts = Object.entries(mainNames).map(([key, label]) => ({
    label,
    count: room.members.filter((m) => m.preferences.main === key).length,
  }));
  const popular = mainCounts
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count);
  const sharers = new Set(
    plan.lines
      .filter((l) => l.memberIds.length > 1)
      .flatMap((l) => l.memberIds),
  ).size;
  const highlights = [
    popular.length
      ? `${popular[0].count} 人同选${popular[0].label}`
      : "口味各不相同，也能吃到一起",
    sharers ? `${sharers} 人共享一份小食` : "每份心愿，都有自己的位置",
  ];
  const paymentLabel =
    plan.payment.mode === "treat"
      ? `${room.members.find((m) => m.id === (plan.payment as { payerId: string }).payerId)!.name}请客 · 其余成员应付 ¥0.00`
      : "各付各的 · 共享项目按参与人数均分";
  const rows = plan.allocations.map((a) => ({
    name: room.members.find((m) => m.id === a.memberId)!.name,
    meal: formatMoney(a.totalCents),
    payable: formatMoney(a.payableCents),
    items: a.items
      .map(
        (i) => `${i.name.replace("（示例）", "")}${i.shared ? "（共享）" : ""}`,
      )
      .join("、"),
  }));
  const text = [
    "麦麦合拍 · 默契小票",
    "虚构菜单与价格 · 非订单 / 非付款凭证",
    `${room.members.length} 位饭搭子 · ${plan.title} · 餐单 v${room.proposalVersion}`,
    ...highlights,
    paymentLabel,
    ...rows.map(
      (r) => `${r.name}：餐品 ${r.meal} / 应付 ${r.payable}\n  ${r.items}`,
    ),
    `整桌合计 ${formatMoney(plan.quote.totalCents)}`,
    "全员确认了同一版餐单。一起吃饭，就是今天的小默契。",
  ].join("\n");
  return {
    rows,
    highlights,
    paymentLabel,
    text,
    total: formatMoney(plan.quote.totalCents),
    title: plan.title,
    people: room.members.length,
    version: room.proposalVersion,
  };
}

export function receiptSvg(receipt: ReturnType<typeof buildReceipt>): string {
  const escape = (s: string) =>
    s
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(
        /[<>&"']/g,
        (c) =>
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
          })[c]!,
      );
  const height = 380 + receipt.rows.length * 78;
  const text = (
    x: number,
    y: number,
    value: string,
    size = 16,
    color = "#292922",
  ) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${escape(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 ${height}">
    <rect width="600" height="${height}" fill="#f8f5ed"/><rect x="20" y="20" width="560" height="${height - 40}" rx="16" fill="#fffdfa"/>
    <g font-family="Microsoft YaHei, sans-serif">
    ${text(52, 74, "麦麦合拍 / 默契小票", 28, "#c94a35")}
    ${text(52, 109, `${receipt.people} 位饭搭子 · ${receipt.title} · v${receipt.version}`)}
    ${text(52, 150, receipt.highlights[0], 20)}${text(52, 181, receipt.highlights[1])}
    ${text(52, 220, receipt.paymentLabel, 14, "#507b61")}
    <path d="M52 240H548" stroke="#e4e0d5" stroke-dasharray="5 5"/>
    ${receipt.rows
      .map(
        (r, i) =>
          text(52, 274 + i * 78, r.name, 19) +
          text(250, 274 + i * 78, `餐品 ${r.meal} / 应付 ${r.payable}`, 14) +
          text(52, 302 + i * 78, r.items, 13, "#7b7b6e"),
      )
      .join("")}
    ${text(52, height - 95, `整桌合计 ${receipt.total}`, 24, "#c94a35")}
    ${text(52, height - 58, "虚构菜单与价格 · 全员确认 · 非订单 / 非付款凭证", 13, "#7b7b6e")}
    </g></svg>`;
}
