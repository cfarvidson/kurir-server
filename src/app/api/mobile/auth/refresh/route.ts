import { NextRequest, NextResponse } from "next/server";
import { rotateTokens } from "@/lib/mobile/tokens";
import { rateLimitMobileLogin, tooManyRequests } from "@/lib/rate-limit";

/**
 * POST /api/mobile/auth/refresh
 *
 * Body: { refreshToken: string }
 *
 * Rotates the refresh token and returns a fresh access token. A 401 means the
 * session is gone (revoked or rotated away) — the client must log in again.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimitMobileLogin(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { refreshToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.refreshToken) {
    return NextResponse.json(
      { error: "Missing refreshToken" },
      { status: 400 },
    );
  }

  const tokens = await rotateTokens(body.refreshToken);
  if (!tokens) {
    return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 });
  }

  return NextResponse.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
  });
}
