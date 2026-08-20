import { getConfig } from "@/lib/config";

export type CalendarOAuthProvider = "GOOGLE" | "MICROSOFT";

const TOKEN_URL: Record<CalendarOAuthProvider, string> = {
  GOOGLE: "https://oauth2.googleapis.com/token",
  MICROSOFT: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

/** Refresh a Google/Microsoft calendar access token via getConfig().oauth. */
export async function refreshCalendarAccessToken(
  provider: CalendarOAuthProvider,
  refreshToken: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}> {
  const oauth = getConfig().oauth;
  const creds = provider === "GOOGLE" ? oauth.google : oauth.microsoft;
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(`OAuth not configured for ${provider}`);
  }

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
