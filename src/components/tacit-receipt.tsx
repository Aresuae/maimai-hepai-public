"use client";
import { Download, Heart } from "lucide-react";
import { buildReceipt, receiptSvg } from "../domain/receipt";
import type { RoomState } from "../domain/types";

export function TacitReceipt({
  room,
  onNotice,
}: {
  room: RoomState;
  onNotice: (text: string) => void;
}) {
  let receipt: ReturnType<typeof buildReceipt>;
  try {
    receipt = buildReceipt(room);
  } catch {
    return null;
  }
  function download() {
    try {
      const fresh = buildReceipt(room);
      const url = URL.createObjectURL(
        new Blob([receiptSvg(fresh)], { type: "image/svg+xml;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "麦麦合拍-默契小票.svg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice(
        "默契小票已生成 SVG 图片，可保存分享；包含昵称、餐品和应付金额。",
      );
    } catch (error) {
      onNotice((error as Error).message);
    }
  }
  return (
    <section className="tacit-receipt" aria-label="默契小票">
      <div className="receipt-mark">
        <Heart size={18} /> TODAY'S LITTLE JOY
      </div>
      <h3>这一桌的默契，留个纪念。</h3>
      <div className="tacit-facts">
        {receipt.highlights.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <p>
        {receipt.people} 位饭搭子 · {receipt.title} · 餐单 v{receipt.version}
      </p>
      <div className="tacit-people">
        {room.members.map((m) => (
          <span key={m.id} className={`avatar ${m.color}`}>
            {m.name.slice(-1)}
          </span>
        ))}
      </div>
      <strong>{receipt.paymentLabel}</strong>
      <p>整桌合计 {receipt.total} · 全员确认</p>
      <button className="outline-button" onClick={download}>
        <Download size={15} /> 下载默契小票（SVG）
      </button>
      <small>
        图片包含昵称、餐品和金额 · 虚构演示数据 · 非订单 / 非付款凭证
      </small>
    </section>
  );
}
