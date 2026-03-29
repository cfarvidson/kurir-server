import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { consumeChallenge } from "@/lib/webauthn-challenge-store";
import { encode } from "next-auth/jwt";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

/**
 * POST /api/auth/webauthn/login/verify
 *
 * Body: AuthenticationResponseJSON from @simplewebauthn/browser's startAuthentication()
 *
 * Looks up the Passkey by credentialId, verifies the authentication response,
 * updates the counter, and issues a NextAuth JWT session cookie.
 */
export async function POST(req: NextRequest) {
  const config = getConfig();
  const sessionKey = req.cookies.get("wa_auth_session")?.value;
  if (!sessionKey) {
    return NextResponse.json(
      { error: "Missing authentication session" },
      { status: 400 },
    );
  }

  const expectedChallenge = consumeChallenge(sessionKey);
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "Challenge expired or invalid" },
      { status: 400 },
    );
  }

  let body: AuthenticationResponseJSON;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  // Look up the passkey by credentialId
  const passkey = await db.passkey.findUnique({
    where: { credentialId: body.id },
    include: { user: true },
  });

  if (!passkey) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      credential: {
        id: passkey.credentialId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        publicKey: isoBase64URL.toBuffer(passkey.publicKey) as any,
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("[webauthn/login/verify]", err);
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

  // Update the counter and device type/backed-up status
  await db.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(newCounter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    },
  });

  // Issue a NextAuth JWT session
  const secret = config.nextauthSecret;
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const cookieName = config.isProduction
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  // NextAuth v5 uses the cookie name as the salt for JWT encryption
  const token = await encode({
    token: { id: passkey.userId, role: passkey.user.role },
    secret,
    salt: cookieName,
    maxAge: 30 * 24 * 60 * 60,
  });

  const response = NextResponse.json({ success: true });

  // Clear the auth session cookie
  response.cookies.set("wa_auth_session", "", { maxAge: 0, path: "/" });

  // Set the NextAuth session cookie
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return response;
}
