import { NextResponse } from "next/server";
import { rateLimitOAuth } from "@/lib/rate-limit";

/**
 * IP for OAuth authorize/token rate limits.
 * First X-Forwarded-For hop, then X-Real-IP, then "local".
 */
export function oauthClientIp(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "local";
}

/** Real HTTP 429 for GET /oauth/authorize (proxy; pages cannot emit status). */
export async function rateLimitOAuthAuthorize(
  pathname: string,
  method: string,
  headers: { get(name: string): string | null },
): Promise<NextResponse | null> {
  if (pathname !== "/oauth/authorize" || method.toUpperCase() !== "GET") {
    return null;
  }
  const limit = await rateLimitOAuth(oauthClientIp(headers));
  if (limit.allowed) return null;
  return new NextResponse("Too many requests", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(limit.retryAfter),
    },
  });
}
