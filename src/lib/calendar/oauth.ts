import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getConfig } from "@/lib/config";

export type CalendarOAuthProvider = "GOOGLE" | "MICROSOFT";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
] as const;

export const MICROSOFT_CALENDAR_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "Calendars.ReadWrite",
] as const;

const AUTH_URL: Record<CalendarOAuthProvider, string> = {
  GOOGLE: "https://accounts.google.com/o/oauth2/v2/auth",
  MICROSOFT: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
};

const TOKEN_URL: Record<CalendarOAuthProvider, string> = {
  GOOGLE: "https://oauth2.googleapis.com/token",
  MICROSOFT: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

const SCOPES: Record<CalendarOAuthProvider, readonly string[]> = {
  GOOGLE: GOOGLE_CALENDAR_SCOPES,
  MICROSOFT: MICROSOFT_CALENDAR_SCOPES,
};

export type CalendarOAuthState = {
  userId: string;
  provider: CalendarOAuthProvider;
  redirect: string;
};

export type CalendarTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  email: string;
};

function providerCreds(provider: CalendarOAuthProvider): {
  clientId: string;
  clientSecret: string;
} {
  const oauth = getConfig().oauth;
  const creds = provider === "GOOGLE" ? oauth.google : oauth.microsoft;
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(`OAuth not configured for ${provider}`);
  }
  return { clientId: creds.clientId, clientSecret: creds.clientSecret };
}

export function isCalendarOAuthEnabled(
  provider: CalendarOAuthProvider,
): boolean {
  const oauth = getConfig().oauth;
  const creds = provider === "GOOGLE" ? oauth.google : oauth.microsoft;
  return Boolean(creds.clientId && creds.clientSecret);
}

export function parseCalendarOAuthProvider(
  raw: string | null,
): CalendarOAuthProvider | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value === "GOOGLE" || value === "MICROSOFT") return value;
  return null;
}

export function getCalendarOAuthRedirectUri(): string {
  return `${getConfig().baseUrl}/api/calendar/oauth/callback`;
}

export function safeCalendarOAuthRedirect(redirect: string | null): string {
  const fallback = "/settings?tab=calendar";
  if (!redirect) return fallback;
  if (!redirect.startsWith("/") || redirect.startsWith("//")) return fallback;
  return redirect;
}

/** Build the authorization URL for Google/Microsoft calendar scopes. */
export function buildCalendarAuthorizationUrl(
  provider: CalendarOAuthProvider,
  redirectUri: string,
  state: string,
): string {
  const creds = providerCreds(provider);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES[provider].join(" "),
    state,
  });

  if (provider === "GOOGLE") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return `${AUTH_URL[provider]}?${params.toString()}`;
}

/** Exchange an authorization code for calendar tokens. */
export async function exchangeCalendarCode(
  provider: CalendarOAuthProvider,
  code: string,
  redirectUri: string,
): Promise<CalendarTokenResponse> {
  const creds = providerCreds(provider);
  const res = await fetch(TOKEN_URL[provider], {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!data.access_token) {
    throw new Error("Token exchange failed: missing access_token");
  }
  if (!data.id_token) {
    throw new Error("Token exchange failed: missing id_token");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    email: extractEmailFromIdToken(data.id_token),
  };
}

/** Refresh a Google/Microsoft calendar access token via getConfig().oauth. */
export async function refreshCalendarAccessToken(
  provider: CalendarOAuthProvider,
  refreshToken: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}> {
  const creds = providerCreds(provider);

  const res = await fetch(TOKEN_URL[provider], {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Token refresh failed: missing access_token");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

export function signCalendarOAuthState(state: CalendarOAuthState): string {
  const secret = getConfig().encryptionKey;
  if (!secret) throw new Error("ENCRYPTION_KEY is not set");
  const nonce = randomBytes(16).toString("hex");
  const encoded = Buffer.from(
    JSON.stringify({ ...state, nonce }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function verifyCalendarOAuthState(state: string): CalendarOAuthState {
  const secret = getConfig().encryptionKey;
  if (!secret) throw new Error("ENCRYPTION_KEY is not set");
  const dot = state.lastIndexOf(".");
  if (dot <= 0) throw new Error("Invalid state format");
  const encoded = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("Invalid state signature");
  }

  const parsed = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const provider = parseCalendarOAuthProvider(
    typeof parsed.provider === "string" ? parsed.provider : null,
  );
  if (
    typeof parsed.userId !== "string" ||
    !provider ||
    typeof parsed.redirect !== "string"
  ) {
    throw new Error("Invalid state payload");
  }
  return {
    userId: parsed.userId,
    provider,
    redirect: parsed.redirect,
  };
}

function extractEmailFromIdToken(idToken: string): string {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid id_token format");

  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  ) as { email?: unknown; preferred_username?: unknown };

  const email =
    (typeof payload.email === "string" && payload.email) ||
    (typeof payload.preferred_username === "string" &&
      payload.preferred_username);
  if (!email) throw new Error("No email claim in id_token");

  return email.toLowerCase();
}
