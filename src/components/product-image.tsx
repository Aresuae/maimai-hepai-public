"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { officialProductImage } from "../domain/product-image";

export function ProductImage({ image, name, variant = "card" }: {
  image?: string; name: string; variant?: "card" | "detail" | "thumb";
}) {
  const src = officialProductImage(image);
  const [failed, setFailed] = useState<string>();
  const unavailable = !src || failed === src;
  return <div className={`product-image product-image-${variant}`}>
    {unavailable ? <span className="product-image-fallback" role="img" aria-label={`${name}，${src ? "图片暂不可用" : "暂无官方图片"}`}>
      <ImageOff size={variant === "thumb" ? 18 : 26} aria-hidden="true" />
      {variant !== "thumb" && <small>{src ? "图片暂不可用" : "暂无官方图片"}</small>}
    </span> : <img src={src} alt={name} width={320} height={320}
      loading={variant === "detail" ? "eager" : "lazy"} decoding="async"
      referrerPolicy="no-referrer" onError={() => setFailed(src)} />}
  </div>;
}
