import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  exchangeCodeForTokens,
  getProviderConfig,
  type OAuthProviderType,
} from "@/lib/oauth-providers";
import { verifyImapWithToken } from "@/lib/mail/imap-verify";

function getRedirectUri() {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base}/api/auth/oauth/callback`;
}

/**
 * GET /api/auth/oauth/callback?code=...&state=...
 * Handles the OAuth redirect from Microsoft/Google.
 * Exchanges the code for tokens, verifies IMAP access, and creates/updates the EmailConnection.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      new URL(`/setup?error=${encodeURIComponent(desc)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/setup?error=Missing+authorization+code", request.url),
    );
  }

  // Verify state matches cookie (CSRF protection)
  const cookieState = request.cookies.get("oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(
      new URL("/setup?error=Invalid+state+parameter", request.url),
    );
  }

  // Parse and verify state: nonce:provider:mode:userId:signature
  const parts = state.split(":");
  if (parts.length !== 5) {
    return NextResponse.redirect(
      new URL("/setup?error=Invalid+state+format", request.url),
    );
  }

  const [nonce, provider, mode, userId, signature] = parts;
  const payload = `${nonce}:${provider}:${mode}:${userId}`;
  const secret = process.env.ENCRYPTION_KEY!;
  const expectedSig = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return NextResponse.redirect(
      new URL("/setup?error=Invalid+state+signature", request.url),
    );
  }

  // Verify session matches the userId in the state (prevents connection hijacking)
  const session = await auth();
  if (!session?.user?.id || session.user.id !== userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const oauthProvider = provider as OAuthProviderType;
  const providerConfig = getProviderConfig(oauthProvider);
  if (!providerConfig) {
    return NextResponse.redirect(
      new URL("/setup?error=OAuth+not+configured", request.url),
    );
  }

  try {
    // Exchange code for tokens
    const redirectUri = getRedirectUri();
    const tokens = await exchangeCodeForTokens(
      oauthProvider,
      code,
      redirectUri,
    );

    // Verify IMAP access with the fresh access token
    const imapOk = await verifyImapWithToken(
      tokens.email,
      tokens.accessToken,
      providerConfig.imapHost,
      providerConfig.imapPort,
    );

    if (!imapOk) {
      return NextResponse.redirect(
        new URL(
          "/setup?error=IMAP+authentication+failed.+Please+ensure+IMAP+is+enabled+for+your+account.",
          request.url,
        ),
      );
    }

    // Upsert the EmailConnection
    const existing = await db.emailConnection.findFirst({
      where: { userId, email: tokens.email },
    });

    if (existing) {
      // Update existing connection to use OAuth
      await db.emailConnection.update({
        where: { id: existing.id },
        data: {
          oauthProvider: provider,
          oauthAccessToken: encrypt(tokens.accessToken),
          oauthRefreshToken: tokens.refreshToken
            ? encrypt(tokens.refreshToken)
            : existing.oauthRefreshToken,
          oauthTokenExpiresAt: tokens.expiresAt,
          oauthError: null,
          encryptedPassword: null,
          imapHost: providerConfig.imapHost,
          imapPort: providerConfig.imapPort,
          smtpHost: providerConfig.smtpHost,
          smtpPort: providerConfig.smtpPort,
        },
      });
    } else {
      // Create new connection
      const connectionCount = await db.emailConnection.count({
        where: { userId },
      });
      const shouldBeDefault = connectionCount === 0;

      if (shouldBeDefault) {
        await db.emailConnection.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      await db.emailConnection.create({
        data: {
          userId,
          email: tokens.email,
          displayName: tokens.email,
          encryptedPassword: null,
          oauthProvider: provider,
          oauthAccessToken: encrypt(tokens.accessToken),
          oauthRefreshToken: tokens.refreshToken
            ? encrypt(tokens.refreshToken)
            : null,
          oauthTokenExpiresAt: tokens.expiresAt,
          imapHost: providerConfig.imapHost,
          imapPort: providerConfig.imapPort,
          smtpHost: providerConfig.smtpHost,
          smtpPort: providerConfig.smtpPort,
          isDefault: shouldBeDefault,
        },
      });
    }

    // Clear the state cookie
    const successUrl = mode === "add" ? "/settings" : "/imbox";
    const response = NextResponse.redirect(new URL(successUrl, request.url));
    response.cookies.delete("oauth_state");
    return response;
  } catch (err) {
    console.error("[oauth callback] Error:", err);
    const message =
      err instanceof Error ? err.message : "OAuth authentication failed";
    return NextResponse.redirect(
      new URL(`/setup?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
