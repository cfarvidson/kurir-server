import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { randomBytes, createHmac } from "crypto";
import {
  buildAuthorizationUrl,
  getProviderConfig,
  type OAuthProviderType,
} from "@/lib/oauth-providers";

const VALID_PROVIDERS = ["microsoft", "google"] as const;

function getRedirectUri() {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base}/api/auth/oauth/callback`;
}

/**
 * GET /api/auth/oauth/microsoft or /api/auth/oauth/google
 * Initiates the OAuth flow by redirecting to the provider's consent screen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const oauthProvider = provider as OAuthProviderType;
  const config = getProviderConfig(oauthProvider);
  if (!config) {
    return NextResponse.json(
      {
        error: `OAuth not configured for ${provider}. Set the required environment variables.`,
      },
      { status: 404 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Build state: nonce:provider:mode:userId, signed with HMAC
  const mode = request.nextUrl.searchParams.get("mode") || "setup";
  const nonce = randomBytes(16).toString("hex");
  const payload = `${nonce}:${provider}:${mode}:${session.user.id}`;
  const secret = process.env.ENCRYPTION_KEY!;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const state = `${payload}:${signature}`;

  const redirectUri = getRedirectUri();
  const authUrl = buildAuthorizationUrl(oauthProvider, redirectUri, state);

  // Set state in a cookie for CSRF verification at callback
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
