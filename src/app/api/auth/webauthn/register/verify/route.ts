import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
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
 * Query: ?addPasskey=true — if present, adds passkey to existing authenticated user
 *
 * Verifies the WebAuthn registration:
 * - Without addPasskey: creates User + Passkey records and issues a session cookie.
 * - With addPasskey: creates only a Passkey record for the current user (no new session).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const addPasskey = url.searchParams.get("addPasskey") === "true";

  const sessionKey = req.cookies.get("wa_reg_session")?.value;
  if (!sessionKey) {
    return NextResponse.json(
      { error: "Missing registration session" },
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

  let body: { credential: RegistrationResponseJSON } | RegistrationResponseJSON;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  // passkeys-list.tsx sends { credential } wrapped; new-user register sends the credential directly
  const registrationResponse: RegistrationResponseJSON =
    "credential" in body
      ? (body as { credential: RegistrationResponseJSON }).credential
      : body;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
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
    return NextResponse.json(
      { error: "Registration not verified" },
      { status: 400 },
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  if (addPasskey) {
    // Adding a passkey to an already-authenticated user — don't create a new User
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.passkey.create({
      data: {
        userId: session.user.id,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(Buffer.from(credential.publicKey)),
        counter: BigInt(credential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.transports ?? [],
      },
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set("wa_reg_session", "", { maxAge: 0, path: "/" });
    return response;
  }

  // Check for invite token
  const inviteToken = url.searchParams.get("invite");

  // New user registration — create User + Passkey in a serializable transaction
  let user;
  try {
    user = await db.$transaction(
      async (tx) => {
        // Validate invite if provided
        let invite = null;
        if (inviteToken) {
          invite = await tx.invite.findUnique({
            where: { token: inviteToken },
          });
          if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
            throw new Error("INVITE_INVALID");
          }
        }

        // Check if signups are enabled (skip if valid invite)
        if (!invite) {
          const settings = await tx.systemSettings.findUnique({
            where: { id: "singleton" },
          });
          if (settings && !settings.signupsEnabled) {
            throw new Error("SIGNUPS_DISABLED");
          }
        }

        // First user becomes ADMIN, all others are USER
        const userCount = await tx.user.count();
        const role = userCount === 0 ? "ADMIN" : "USER";

        const newUser = await tx.user.create({
          data: {
            role,
            displayName: invite?.displayName || null,
            passkeys: {
              create: {
                credentialId: credential.id,
                publicKey: isoBase64URL.fromBuffer(
                  Buffer.from(credential.publicKey),
                ),
                counter: BigInt(credential.counter),
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp,
                transports: credential.transports ?? [],
              },
            },
          },
        });

        // Consume the invite
        if (invite) {
          await tx.invite.update({
            where: { id: invite.id },
            data: { usedAt: new Date(), usedBy: newUser.id },
          });
        }

        return newUser;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "SIGNUPS_DISABLED") {
      return NextResponse.json(
        { error: "Registration is currently closed" },
        { status: 403 },
      );
    }
    if (err instanceof Error && err.message === "INVITE_INVALID") {
      return NextResponse.json(
        { error: "Invalid or expired invite" },
        { status: 403 },
      );
    }
    throw err;
  }

  // Issue a NextAuth JWT session so the user is immediately logged in
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const cookieName =
    process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

  // NextAuth v5 uses the cookie name as the salt for JWT encryption
  const token = await encode({
    token: { id: user.id, role: user.role },
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
