import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { setChallenge } from "@/lib/webauthn-challenge-store";
import { randomBytes } from "crypto";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Kurir";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";

/**
 * POST /api/auth/webauthn/register/options
 *
 * Body: { displayName?: string }
 * Query: ?addPasskey=true — if present, requires active session and adds passkey to existing user
 *
 * Generates WebAuthn registration options. The challenge is stored server-side
 * and keyed by a session token returned in a cookie.
 *
 * Callers must pass the returned options to @simplewebauthn/browser's
 * startRegistration({ optionsJSON: options.options }), then POST the result to
 * /api/auth/webauthn/register/verify.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const addPasskey = url.searchParams.get("addPasskey") === "true";

  let existingPasskeys: { credentialId: string; transports: string[] }[] = [];
  let userIdBytes: Uint8Array<ArrayBuffer>;
  let userName: string;
  let userDisplayName: string;

  if (addPasskey) {
    // Adding a passkey to an already-authenticated user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // Fetch existing passkeys to exclude them (prevents re-registering same device)
    existingPasskeys = await db.passkey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    userIdBytes = Buffer.from(userId) as unknown as Uint8Array<ArrayBuffer>;
    userName = "user";
    userDisplayName = "";
  } else {
    // New user registration — generate a temporary user ID
    const body = await req.json().catch(() => ({}));
    const displayName: string | undefined = body?.displayName;

    userIdBytes = randomBytes(16) as unknown as Uint8Array<ArrayBuffer>;
    userName = displayName ?? "user";
    userDisplayName = displayName ?? "";
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userIdBytes,
    userName,
    userDisplayName,
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
