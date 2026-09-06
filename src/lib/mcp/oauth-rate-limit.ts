import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { rateLimitOAuth } from "@/lib/rate-limit";

/** Real HTTP 429 for GET /oauth/authorize (proxy; pages cannot emit status). */
export async function rateLimitOAuthAuthorize(
  pathname: string,
  method: string,
  headers: { get(name: string): string | null },
): Promise<NextResponse | null> {
  if (pathname !== "/oauth/authorize" || method.toUpperCase() !== "GET") {
    return null;
  }
  const limit = await rateLimitOAuth(getClientIp(headers));
  if (limit.allowed) return null;
  return new NextResponse("Too many requests", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(limit.retryAfter),
    },
  });
}
