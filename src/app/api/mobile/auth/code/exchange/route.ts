import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { consumeAuthCode } from "@/lib/mobile/auth-code-store";
import { issueTokens, tokensEqual } from "@/lib/mobile/tokens";
import { rateLimitMobileLogin, tooManyRequests } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

/**
 * POST /api/mobile/auth/code/exchange
 *
 * Exchanges a one-time code (from /api/mobile/auth/code) for bearer tokens.
 * PKCE binds the code to the app run that minted the challenge: the caller
 * must present the verifier whose SHA-256 matches the stored challenge, so a
 * different app that grabbed the kurir:// callback cannot use a stolen code.
 *
 * Body: { code: string; codeVerifier: string; deviceName?: string }
 *
 * Responds with the same payload shape as passkey/verify.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const limit = await rateLimitMobileLogin(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { code?: string; codeVerifier?: string; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
    return NextResponse.json(
      { error: "Missing code or codeVerifier" },
      { status: 400 },
    );
  }

  const entry = consumeAuthCode(body.code);
  if (!entry)
    return NextResponse.json(
      { error: "Code expired or invalid" },
      { status: 400 },
    );

  const expected = createHash("sha256")
    .update(body.codeVerifier)
    .digest("base64url");
  if (!tokensEqual(expected, entry.codeChallenge))
    return NextResponse.json(
      { error: "PKCE verification failed" },
      { status: 400 },
    );

  const user = await db.user.findUnique({
    where: { id: entry.userId },
    select: { displayName: true },
  });

  const tokens = await issueTokens(entry.userId, body.deviceName);

  return NextResponse.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    user: {
      id: entry.userId,
      displayName: user?.displayName ?? null,
    },
  });
}
