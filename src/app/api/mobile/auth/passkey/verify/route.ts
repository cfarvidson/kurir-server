import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { consumeChallenge } from "@/lib/webauthn-challenge-store";
import { issueTokens } from "@/lib/mobile/tokens";
import { rateLimitMobileLogin, tooManyRequests } from "@/lib/rate-limit";

/**
 * POST /api/mobile/auth/passkey/verify
 *
 * Body: {
 *   challengeKey: string   — from /api/mobile/auth/passkey/options
 *   credential: AuthenticationResponseJSON — from ASAuthorization on iOS
 *   deviceName?: string    — e.g. "iPhone 16 Pro"
 * }
 *
 * Mobile variant of /api/auth/webauthn/login/verify: same passkey
 * verification, but issues bearer tokens instead of a session cookie.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimitMobileLogin(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const config = getConfig();

  let body: {
    challengeKey?: string;
    credential?: AuthenticationResponseJSON;
    deviceName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.challengeKey || !body.credential?.id) {
    return NextResponse.json(
      { error: "Missing challengeKey or credential" },
      { status: 400 },
    );
  }

  const expectedChallenge = consumeChallenge(body.challengeKey);
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "Challenge expired or invalid" },
      { status: 400 },
    );
  }

  const passkey = await db.passkey.findUnique({
    where: { credentialId: body.credential.id },
    include: { user: true },
  });

  if (!passkey) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey) as any,
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("[mobile/auth/passkey/verify]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json(
      { error: "Authentication not verified" },
      { status: 401 },
    );
  }

  const { newCounter, credentialDeviceType, credentialBackedUp } =
    verification.authenticationInfo;

  await db.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(newCounter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    },
  });

  const tokens = await issueTokens(passkey.userId, body.deviceName);

  return NextResponse.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    user: {
      id: passkey.userId,
      displayName: passkey.user.displayName,
    },
  });
}
