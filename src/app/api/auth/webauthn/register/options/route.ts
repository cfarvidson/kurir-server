import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { auth } from "@/lib/auth";
import { setChallenge } from "@/lib/webauthn-challenge-store";
import { randomBytes } from "crypto";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { rateLimitRegistration, tooManyRequests } from "@/lib/rate-limit";

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
  const config = getConfig();
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
    // Rate limit registration: 3 per 10 minutes per IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimitRegistration(ip);
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    // Check for invite token (bypasses signups check)
    const inviteToken = url.searchParams.get("invite");
    let hasValidInvite = false;
    if (inviteToken) {
      const invite = await db.invite.findUnique({
        where: { token: inviteToken },
        select: { usedAt: true, expiresAt: true },
      });
      hasValidInvite =
        !!invite && !invite.usedAt && invite.expiresAt > new Date();
    }

    // New user registration — check if signups are enabled (skip with valid invite)
    if (!hasValidInvite) {
      const settings = await db.systemSettings.findUnique({
        where: { id: "singleton" },
      });
      if (settings && !settings.signupsEnabled) {
        return NextResponse.json(
          { error: "Registration is currently closed" },
          { status: 403 },
        );
      }
    }

    // Generate a temporary user ID
    const body = await req.json().catch(() => ({}));
    const displayName: string | undefined = body?.displayName;

    userIdBytes = randomBytes(16) as unknown as Uint8Array<ArrayBuffer>;
    userName = displayName ?? "user";
    userDisplayName = displayName ?? "";
  }

  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
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
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 5 * 60, // 5 minutes
    path: "/",
  });

  return response;
}
