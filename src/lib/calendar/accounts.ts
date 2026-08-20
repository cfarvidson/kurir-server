import { createAccount, getBasicAuthHeaders } from "tsdav";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  enqueueCalendarSyncJob,
  unscheduleCalendarSyncJob,
} from "@/lib/jobs/calendar-sync-worker";
import type { CalendarOAuthProvider } from "@/lib/calendar/oauth";

export function normalizeCalDavUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("CalDAV URL is required");
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export async function discoverCalDavHome(input: {
  url: string;
  username: string;
  password: string;
}): Promise<string> {
  const serverUrl = normalizeCalDavUrl(input.url);
  const account = await createAccount({
    account: {
      serverUrl,
      credentials: {
        username: input.username,
        password: input.password,
      },
      accountType: "caldav",
    },
    headers: getBasicAuthHeaders({
      username: input.username,
      password: input.password,
    }),
  });
  if (!account.homeUrl) {
    throw new Error("Could not find CalDAV calendar home");
  }
  return account.homeUrl;
}

function calDavDisplayName(username: string, homeUrl: string): string {
  const trimmed = username.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(homeUrl).host;
  } catch {
    return "CalDAV";
  }
}

function maybeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

export async function createCalDavAccount(input: {
  userId: string;
  url: string;
  username: string;
  password: string;
}): Promise<{ id: string }> {
  const username = input.username.trim();
  const password = input.password;
  if (!username) throw new Error("CalDAV username is required");
  if (!password) throw new Error("CalDAV password is required");

  let homeUrl: string;
  try {
    homeUrl = await discoverCalDavHome({
      url: input.url,
      username,
      password,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`CalDAV discovery failed: ${message}`);
  }

  const existing = await db.calendarAccount.findFirst({
    where: {
      userId: input.userId,
      provider: "CALDAV",
      caldavUsername: username,
      caldavUrl: homeUrl,
    },
    select: { id: true },
  });

  const data = {
    displayName: calDavDisplayName(username, homeUrl),
    principalEmail: maybeEmail(username),
    caldavUrl: homeUrl,
    caldavUsername: username,
    encryptedPassword: encrypt(password),
    lastError: null,
  };

  const account = existing
    ? await db.calendarAccount.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      })
    : await db.calendarAccount.create({
        data: {
          userId: input.userId,
          provider: "CALDAV",
          ...data,
        },
        select: { id: true },
      });

  await enqueueCalendarSyncJob(account.id, input.userId, { immediate: true });
  return account;
}

export async function createOauthCalendarAccount(input: {
  userId: string;
  provider: CalendarOAuthProvider;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.calendarAccount.findFirst({
    where: {
      userId: input.userId,
      provider: input.provider,
      principalEmail: email,
    },
    select: { id: true, oauthRefreshToken: true, emailConnectionId: true },
  });

  const connection =
    existing?.emailConnectionId
      ? null
      : await db.emailConnection.findFirst({
          where: { userId: input.userId, email },
          select: { id: true },
        });

  const tokenData = {
    displayName: email,
    principalEmail: email,
    oauthAccessToken: encrypt(input.accessToken),
    oauthTokenExpiresAt: input.expiresAt,
    oauthError: null,
    lastError: null,
    ...(input.refreshToken
      ? { oauthRefreshToken: encrypt(input.refreshToken) }
      : {}),
    ...(connection ? { emailConnectionId: connection.id } : {}),
  };

  const account = existing
    ? await db.calendarAccount.update({
        where: { id: existing.id },
        data: tokenData,
        select: { id: true },
      })
    : await db.calendarAccount.create({
        data: {
          userId: input.userId,
          provider: input.provider,
          ...tokenData,
        },
        select: { id: true },
      });

  await enqueueCalendarSyncJob(account.id, input.userId, { immediate: true });
  return account;
}

export async function deleteCalendarAccount(
  userId: string,
  accountId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const account = await tx.calendarAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!account) throw new Error("Calendar account not found");

    const masters = await tx.calendarEvent.findMany({
      where: {
        userId,
        masterEventId: null,
        recurrenceId: null,
        calendar: { accountId },
      },
      select: { id: true, providerEventId: true },
    });

    if (masters.length > 0) {
      await tx.calendarTombstone.createMany({
        data: masters.map((row) => ({
          eventId: row.id,
          providerEventId: row.providerEventId,
          userId,
        })),
        skipDuplicates: true,
      });
    }
    await tx.calendarAccount.delete({ where: { id: accountId } });
  });

  await unscheduleCalendarSyncJob(accountId);
}

export async function setCalendarVisibleForUser(
  userId: string,
  calendarId: string,
  isVisible: boolean,
): Promise<void> {
  const calendar = await db.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true },
  });
  if (!calendar) throw new Error("Calendar not found");
  await db.calendar.update({
    where: { id: calendarId },
    data: { isVisible },
  });
}
