import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getConfig } from "@/lib/config";
import { setChallenge } from "@/lib/webauthn-challenge-store";
import { randomBytes } from "crypto";

/**
 * POST /api/auth/webauthn/login/options
 *
 * Generates WebAuthn authentication options. We leave allowCredentials empty
 * to support discoverable credentials (passkey autofill) — the browser will
 * prompt the user to select from their stored credentials.
 *
 * The challenge is stored server-side keyed by a cookie.
 */
export async function POST() {
  const config = getConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    userVerification: "preferred",
    // Empty allowCredentials = discoverable credentials (passkey autofill)
    allowCredentials: [],
  });

  const sessionKey = randomBytes(32).toString("hex");
  setChallenge(sessionKey, options.challenge);

  const response = NextResponse.json({ options });
  response.cookies.set("wa_auth_session", sessionKey, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 5 * 60, // 5 minutes
    path: "/",
  });

  return response;
}
