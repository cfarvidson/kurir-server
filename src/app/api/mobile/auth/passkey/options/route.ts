import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getConfig } from "@/lib/config";
import { setChallenge } from "@/lib/webauthn-challenge-store";
import { randomBytes } from "crypto";
import { rateLimitMobileLogin, tooManyRequests } from "@/lib/rate-limit";

/**
 * POST /api/mobile/auth/passkey/options
 *
 * Mobile variant of /api/auth/webauthn/login/options. Native clients cannot
 * rely on cookies, so the challenge key is returned in the response body and
 * echoed back in the verify call.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimitMobileLogin(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const config = getConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    userVerification: "preferred",
    // Empty allowCredentials = discoverable credentials (passkey picker)
    allowCredentials: [],
  });

  const challengeKey = randomBytes(32).toString("hex");
  setChallenge(challengeKey, options.challenge);

  return NextResponse.json({ challengeKey, options });
}
