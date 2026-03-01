import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { setChallenge } from "@/lib/webauthn-challenge-store";
import { randomBytes } from "crypto";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Kurir";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";

/**
 * POST /api/auth/webauthn/register/options
 *
 * Body: { displayName?: string }
 *
 * Generates WebAuthn registration options. The challenge is stored server-side
 * and keyed by a session token returned in a cookie.
 *
 * Callers must pass the returned options to @simplewebauthn/browser's
 * startRegistration(), then POST the result to /api/auth/webauthn/register/verify.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const displayName: string | undefined = body?.displayName;

  // Generate a temporary user ID for the registration options.
  // The real User record is created only after successful verification.
  const tempUserId = randomBytes(16);

  // Fetch existing passkeys for this user (empty for new registration).
  // For re-registration (adding another device), the client should be logged in —
  // that flow is handled separately via the /api/connections routes.
  const existingPasskeys: { credentialId: string; transports: string[] }[] = [];

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: tempUserId,
    userName: displayName ?? "user",
    userDisplayName: displayName ?? "",
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Generate a session key to track this challenge server-side
  const sessionKey = randomBytes(32).toString("hex");
  setChallenge(sessionKey, options.challenge);

  const response = NextResponse.json({ options });
  // Store the session key in a short-lived httpOnly cookie
  response.cookies.set("wa_reg_session", sessionKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 5 * 60, // 5 minutes
    path: "/",
  });

  return response;
}
