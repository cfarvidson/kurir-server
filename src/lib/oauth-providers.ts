import { encrypt, decrypt } from "./crypto";
import { db } from "./db";

export type OAuthProviderType = "microsoft" | "google";

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  email: string;
}

const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "offline_access",
  // Use outlook.office.com (not office365.com) — required for personal account support
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
];

const GOOGLE_SCOPES = ["openid", "email", "https://mail.google.com/"];

/**
 * Returns provider config if the required env vars are set, null otherwise.
 */
export function getProviderConfig(
  provider: OAuthProviderType,
): ProviderConfig | null {
  if (provider === "microsoft") {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      clientId,
      clientSecret,
      scopes: MICROSOFT_SCOPES,
      imapHost: "outlook.office365.com",
      imapPort: 993,
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
    };
  }

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId,
      clientSecret,
      scopes: GOOGLE_SCOPES,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
    };
  }

  return null;
}

/**
 * Build the authorization URL for the OAuth provider.
 */
export function buildAuthorizationUrl(
  provider: OAuthProviderType,
  redirectUri: string,
  state: string,
): string {
  const config = getProviderConfig(provider);
  if (!config) throw new Error(`OAuth not configured for ${provider}`);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: config.scopes.join(" "),
    state,
  });

  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return `${config.authUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  provider: OAuthProviderType,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const config = getProviderConfig(provider);
  if (!config) throw new Error(`OAuth not configured for ${provider}`);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const email = extractEmailFromIdToken(data.id_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    email,
  };
}

/**
 * Refresh an access token using a refresh token.
 * Returns the new access token and expiry.
 */
export async function refreshAccessToken(
  provider: OAuthProviderType,
  refreshToken: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}> {
  const config = getProviderConfig(provider);
  if (!config) throw new Error(`OAuth not configured for ${provider}`);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Refresh an access token for a connection and persist the new tokens.
 * Returns the fresh access token. Sets oauthError on failure.
 */
export async function refreshAndPersistToken(
  connectionId: string,
  provider: OAuthProviderType,
  encryptedRefreshToken: string,
): Promise<string> {
  try {
    const decryptedRefresh = decrypt(encryptedRefreshToken);
    const fresh = await refreshAccessToken(provider, decryptedRefresh);

    await db.emailConnection.update({
      where: { id: connectionId },
      data: {
        oauthAccessToken: encrypt(fresh.accessToken),
        oauthTokenExpiresAt: fresh.expiresAt,
        oauthError: null,
        // Microsoft may rotate refresh tokens
        ...(fresh.refreshToken
          ? { oauthRefreshToken: encrypt(fresh.refreshToken) }
          : {}),
      },
    });

    return fresh.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    await db.emailConnection.update({
      where: { id: connectionId },
      data: { oauthError: message },
    });
    throw err;
  }
}

/**
 * Extract email from the id_token JWT payload (base64url-decoded, not verified).
 * Safe because the token was just received from the provider over HTTPS.
 */
function extractEmailFromIdToken(idToken: string): string {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid id_token format");

  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  );

  const email = payload.email || payload.preferred_username;
  if (!email) throw new Error("No email claim in id_token");

  return email.toLowerCase();
}

/**
 * Check if OAuth is configured for a given provider.
 */
export function isOAuthEnabled(provider: OAuthProviderType): boolean {
  return getProviderConfig(provider) !== null;
}
