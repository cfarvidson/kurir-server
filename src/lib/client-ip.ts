/**
 * Client address behind a single reverse proxy (Caddy / kamal-proxy).
 *
 * The leftmost X-Forwarded-For hop is attacker-controlled whenever a client
 * sends that header. The immediate proxy appends (or sets) the rightmost hop
 * and often also sets X-Real-IP to the socket peer it saw.
 */
export function getClientIp(headers: {
  get(name: string): string | null;
}): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}
