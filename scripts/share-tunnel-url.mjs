export function tunnelUrlFromLine(line, cloudflare) {
  if (cloudflare) return line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0] ?? null;
  // The banner also links to admin.localhost.run. Accept only the forwarding registration event.
  try {
    const event = JSON.parse(line);
    if (event.type !== "v1.tcpip_forward.register.accepted" || event.source !== "ssh://localhost.run/" || typeof event.data !== "string") return null;
    return event.data.match(/https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)\b/)?.[0] ?? null;
  } catch { return null; }
}
