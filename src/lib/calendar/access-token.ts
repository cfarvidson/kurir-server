import type { CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshCalendarAccessToken } from "@/lib/calendar/oauth";

const OAUTH_REFRESH_BUFFER_MS = 60_000;

export class CalendarOauthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarOauthError";
  }
}

export type CalendarAccountTokens = {
  id: string;
  provider: CalendarProvider;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthTokenExpiresAt: Date | null;
};

async function setOauthError(accountId: string, message: string): Promise<void> {
  await db.calendarAccount.update({
    where: { id: accountId },
    data: { oauthError: message },
  });
}

/** Refresh Google/Microsoft access tokens; CalDAV returns null. */
export async function ensureAccessToken(
  account: CalendarAccountTokens,
): Promise<string | null> {
  if (account.provider === "CALDAV") return null;

  const freshEnough =
    account.oauthAccessToken &&
    account.oauthTokenExpiresAt &&
    account.oauthTokenExpiresAt.getTime() - Date.now() >=
      OAUTH_REFRESH_BUFFER_MS;

  if (freshEnough && account.oauthAccessToken) {
    return decrypt(account.oauthAccessToken);
  }

  if (!account.oauthRefreshToken) {
    const message = "No refresh token available";
    await setOauthError(account.id, message);
    throw new CalendarOauthError(message);
  }

  try {
    const fresh = await refreshCalendarAccessToken(
      account.provider,
      decrypt(account.oauthRefreshToken),
    );
    await db.calendarAccount.update({
      where: { id: account.id },
      data: {
        oauthAccessToken: encrypt(fresh.accessToken),
        oauthTokenExpiresAt: fresh.expiresAt,
        oauthError: null,
        ...(fresh.refreshToken
          ? { oauthRefreshToken: encrypt(fresh.refreshToken) }
          : {}),
      },
    });
    return fresh.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    await setOauthError(account.id, message);
    throw new CalendarOauthError(message);
  }
}
