import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { encode } from "next-auth/jwt";
import { rateLimitMobileLogin, tooManyRequests } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

/**
 * POST /api/auth/demo-login
 *
 * Body: { email: string, password: string }
 *
 * Password sign-in for DEMO instances only — the normal login is
 * passkey-only, which App Store reviewers cannot use. The route is a 404
 * unless BOTH `DEMO_LOGIN_EMAIL` and `DEMO_LOGIN_PASSWORD` are set in the
 * environment, and it can only ever sign in that single pre-provisioned
 * demo user. Never set these variables on a real instance.
 */
export async function POST(req: NextRequest) {
  const demoEmail = process.env.DEMO_LOGIN_EMAIL;
  const demoPassword = process.env.DEMO_LOGIN_PASSWORD;
  if (!demoEmail || !demoPassword) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = getClientIp(req.headers);
  const limit = await rateLimitMobileLogin(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { error: "Missing email or password" },
      { status: 400 },
    );
  }

  if (
    !constantTimeEquals(body.email.toLowerCase(), demoEmail.toLowerCase()) ||
    !constantTimeEquals(body.password, demoPassword)
  ) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // User has no email column (passkey identity) — the demo user is found
  // via the EmailConnection carrying the demo address.
  const connection = await db.emailConnection.findFirst({
    where: { email: demoEmail },
    include: { user: true },
  });
  const user = connection?.user;
  if (!user) {
    console.error("[demo-login] DEMO_LOGIN_EMAIL has no matching connection");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  // Issue the same NextAuth JWT session cookie as the passkey verify route.
  const config = getConfig();
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
    token: { id: user.id, role: user.role },
    secret,
    salt: cookieName,
    maxAge: 30 * 24 * 60 * 60,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return response;
}

/** Length-safe wrapper around timingSafeEqual for user-supplied strings. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare b against itself to keep timing independent of the mismatch.
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
