import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "麦麦合拍 · 一起选，合拍吃",
  description: "让每个人的小心愿都有位置。多人协作点餐与分账的本地演示原型。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
