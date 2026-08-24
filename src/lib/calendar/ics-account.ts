/**
 * Subscribe to a public ICS URL. Canonicalise, refuse private destinations,
 * fetch over HTTPS, and upsert one read-only CalendarAccount.
 */
import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import { enqueueCalendarSyncJob } from "@/lib/jobs/calendar-sync-worker";
import {
  canonicalizeIcsUrl,
  fetchIcsFeed,
  parseIcsCalendarName,
} from "@/lib/calendar/ics-url";

export {
  canonicalizeIcsUrl,
  fetchIcsFeed,
  icsAddressIsBlocked,
  ICS_MAX_BYTES,
  parseIcsCalendarName,
} from "@/lib/calendar/ics-url";

export async function createIcsAccount(input: {
  userId: string;
  url: string;
  accountId?: string;
}): Promise<{ id: string }> {
  if (isDemoInstance()) {
    throw new Error("Calendar subscribe is disabled on this demo instance.");
  }

  const canonical = canonicalizeIcsUrl(input.url);
  const host = new URL(canonical).host;

  let reconnectId: string | null = null;
  if (input.accountId) {
    const owned = await db.calendarAccount.findFirst({
      where: {
        id: input.accountId,
        userId: input.userId,
        provider: "ICS",
      },
      select: { id: true },
    });
    if (!owned) throw new Error("Calendar account not found");
    reconnectId = owned.id;
  }

  const fetched = await fetchIcsFeed(canonical);
  const displayName = parseIcsCalendarName(fetched.body, host);

  const existing = reconnectId
    ? { id: reconnectId }
    : await db.calendarAccount.findFirst({
        where: {
          userId: input.userId,
          provider: "ICS",
          caldavUrl: canonical,
        },
        select: { id: true },
      });

  const data = {
    displayName,
    principalEmail: null as string | null,
    caldavUrl: canonical,
    caldavUsername: null as string | null,
    encryptedPassword: null as string | null,
    lastError: null as string | null,
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
          provider: "ICS",
          ...data,
        },
        select: { id: true },
      });

  await db.calendar.upsert({
    where: {
      accountId_providerCalendarId: {
        accountId: account.id,
        providerCalendarId: canonical,
      },
    },
    create: {
      providerCalendarId: canonical,
      name: displayName,
      color: null,
      isPrimary: true,
      isReadOnly: true,
      timezone: null,
      isVisible: true,
      accountId: account.id,
      userId: input.userId,
    },
    update: {
      name: displayName,
      isReadOnly: true,
      isPrimary: true,
    },
  });

  await enqueueCalendarSyncJob(account.id, input.userId, { immediate: true });
  return account;
}
