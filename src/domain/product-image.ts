/** Public product CDN observed in query-meals / query-meal-detail.
 * Never forward account credentials or accept arbitrary remote image hosts. */
export function officialProductImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1024) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "menu-img.mcd.cn" ||
      url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith("/pcm/") || !/\.(png|jpe?g|webp|avif|gif)$/i.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}
