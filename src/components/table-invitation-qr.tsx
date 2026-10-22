"use client";
import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download, ScanLine } from "lucide-react";

export function TableInvitationQr({ link }: { link: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setImage(""); setError("");
    // Wait until the child canvas has painted before preparing the PNG link.
    const frame = requestAnimationFrame(() => {
      try { if (canvas.current) setImage(canvas.current.toDataURL("image/png")); }
      catch { setError("暂时无法保存图片，可以截图二维码或复制邀请链接。"); }
    });
    return () => cancelAnimationFrame(frame);
  }, [link]);
  return <div className="shared-qr-panel">
    <strong><ScanLine size={17} />扫码加入这张餐桌</strong>
    <div className="shared-qr-image">
      <QRCodeCanvas ref={canvas} value={link} size={224} marginSize={4} level="M" bgColor="#ffffff" fgColor="#161616" role="img" aria-label="共享餐桌邀请二维码" />
    </div>
    <p>用手机扫一扫，也可保存图片发给朋友。</p>
    {image ? <a className="outline-button" href={image} download="麦麦合拍-餐桌邀请.png"><Download size={15} />保存邀请二维码</a> : <button className="outline-button" disabled>正在准备二维码图片…</button>}
    {error && <p role="status">{error}</p>}
  </div>;
}
