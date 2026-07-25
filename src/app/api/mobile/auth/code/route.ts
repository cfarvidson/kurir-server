import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createAuthCode } from "@/lib/mobile/auth-code-store";

/**
 * POST /api/mobile/auth/code
 *
 * Session-authenticated mint of a one-time login code for the web-session
 * mobile login flow. The proxy lets everything under /api/mobile through
 * without a session check, so this handler MUST authenticate the session
 * itself — a code is never minted without a logged-in user.
 *
 * Body: { codeChallenge: string }  — PKCE S256 challenge, 43-char base64url.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { codeChallenge } = await req.json().catch(() => ({}));
  if (
    typeof codeChallenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
  )
    return NextResponse.json(
      { error: "Invalid codeChallenge" },
      { status: 400 },
    );

  return NextResponse.json({
    code: createAuthCode(session.user.id, codeChallenge),
  });
}
