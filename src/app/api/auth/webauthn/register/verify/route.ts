import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { consumeChallenge } from "@/lib/webauthn-challenge-store";
import { encode } from "next-auth/jwt";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN =
  process.env.NEXTAUTH_URL ??
  (process.env.NODE_ENV === "production"
    ? `https://${RP_ID}`
    : `http://localhost:3000`);

/**
 * POST /api/auth/webauthn/register/verify
 *
 * Body: RegistrationResponseJSON from @simplewebauthn/browser's startRegistration()
 *
 * Verifies the WebAuthn registration, creates the User + Passkey records,
 * and issues a NextAuth JWT session cookie.
 */
export async function POST(req: NextRequest) {
  const sessionKey = req.cookies.get("wa_reg_session")?.value;
  if (!sessionKey) {
    return NextResponse.json({ error: "Missing registration session" }, { status: 400 });
  }

  const expectedChallenge = consumeChallenge(sessionKey);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Challenge expired or invalid" }, { status: 400 });
  }

  let body: RegistrationResponseJSON;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("[webauthn/register/verify]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Registration not verified" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  // Create the User and Passkey records in a transaction
  const user = await db.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        passkeys: {
          create: {
            credentialId: credential.id,
            publicKey: isoBase64URL.fromBuffer(Buffer.from(credential.publicKey)),
            counter: BigInt(credential.counter),
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
            transports: credential.transports ?? [],
          },
        },
      },
    });
    return newUser;
  });

  // Issue a NextAuth JWT session so the user is immediately logged in
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const cookieName =
    process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

  // NextAuth v5 uses the cookie name as the salt for JWT encryption
  const token = await encode({
    token: { id: user.id },
    secret,
    salt: cookieName,
    maxAge: 30 * 24 * 60 * 60,
  });

  const response = NextResponse.json({ success: true });

  // Clear the registration session cookie
  response.cookies.set("wa_reg_session", "", { maxAge: 0, path: "/" });

  // Set the auth session cookie
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return response;
}
