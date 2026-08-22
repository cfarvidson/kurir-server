import type { CalendarProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { isDemoInstance } from "@/lib/demo";
import {
  CalendarOauthError,
  ensureAccessToken,
} from "@/lib/calendar/access-token";
import { applyPull } from "@/lib/calendar/apply-pull";
import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";
import { createGoogleAdapter } from "@/lib/calendar/providers/google";
import { createMicrosoftAdapter } from "@/lib/calendar/providers/microsoft";
import type { CalendarAdapter } from "@/lib/calendar/providers/types";
import {
  claimCalendarSyncLock,
  heartbeatCalendarSyncLock,
  releaseCalendarSyncLock,
} from "@/lib/calendar/sync-lock";
import {
  CALENDAR_SYNC_QUEUE,
  Worker,
  getCalendarSyncQueue,
  getRedisConnection,
} from "./queue";

export type CalendarSyncJobData = {
  calendarAccountId: string;
  userId: string;
};

type AccountRow = {
  id: string;
  userId: string;
  provider: CalendarProvider;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthTokenExpiresAt: Date | null;
  caldavUrl: string | null;
  caldavUsername: string | null;
  encryptedPassword: string | null;
};

function adapterForAccount(
  account: AccountRow,
  accessToken: string | null,
): CalendarAdapter {
  if (account.provider === "GOOGLE") {
    if (!accessToken) throw new Error("Missing OAuth token");
    return createGoogleAdapter({ accessToken });
  }
  if (account.provider === "MICROSOFT") {
    if (!accessToken) throw new Error("Missing OAuth token");
    return createMicrosoftAdapter({ accessToken });
  }
  if (
    !account.caldavUrl ||
    !account.caldavUsername ||
    !account.encryptedPassword
  ) {
    throw new Error("Missing CalDAV credentials");
  }
  return createCalDavAdapter({
    url: account.caldavUrl,
    username: account.caldavUsername,
    password: decrypt(account.encryptedPassword),
  });
}

async function upsertCalendars(
  account: AccountRow,
  adapter: CalendarAdapter,
): Promise<string[]> {
  const remote = await adapter.listCalendars();
  const remoteIds = remote.map((c) => c.providerCalendarId);

  for (const cal of remote) {
    await db.calendar.upsert({
      where: {
        accountId_providerCalendarId: {
          accountId: account.id,
          providerCalendarId: cal.providerCalendarId,
        },
      },
      create: {
        providerCalendarId: cal.providerCalendarId,
        name: cal.name,
        color: cal.color,
        isPrimary: cal.isPrimary,
        isReadOnly: cal.isReadOnly,
        timezone: cal.timezone,
        isVisible: true,
        accountId: account.id,
        userId: account.userId,
      },
      update: {
        name: cal.name,
        color: cal.color,
        isPrimary: cal.isPrimary,
        isReadOnly: cal.isReadOnly,
        timezone: cal.timezone,
      },
    });
  }

  // Empty list is a provider glitch, not "every calendar disappeared".
  if (remoteIds.length === 0) return [];

  await db.calendar.updateMany({
    where: {
      accountId: account.id,
      providerCalendarId: { notIn: remoteIds },
    },
    data: { isVisible: false },
  });

  return remoteIds;
}

async function pullOneCalendar(
  account: AccountRow,
  adapter: CalendarAdapter,
  calendar: {
    id: string;
    providerCalendarId: string;
    syncToken: string | null;
  },
): Promise<void> {
  let cursor: string | null = null;

  for (;;) {
    await heartbeatCalendarSyncLock(account.id);
    const pull = await adapter.pull(
      {
        providerCalendarId: calendar.providerCalendarId,
        syncToken: calendar.syncToken,
      },
      cursor,
    );
    await applyPull({
      userId: account.userId,
      accountId: account.id,
      calendarId: calendar.id,
      pull,
      now: new Date(),
    });

    const data: { syncToken?: string; lastError: null } = { lastError: null };
    if (pull.cursor && (pull.complete || calendar.syncToken)) {
      data.syncToken = pull.cursor;
    }
    await db.calendar.update({
      where: { id: calendar.id },
      data,
    });

    if (pull.complete || !pull.cursor || calendar.syncToken) break;
    cursor = pull.cursor;
  }
}

async function syncAccount(account: AccountRow): Promise<void> {
  const accessToken = await ensureAccessToken(account);
  const adapter = adapterForAccount(account, accessToken);
  const remoteIds = await upsertCalendars(account, adapter);

  if (remoteIds.length === 0) return;

  const calendars = await db.calendar.findMany({
    where: {
      accountId: account.id,
      providerCalendarId: { in: remoteIds },
    },
    select: {
      id: true,
      providerCalendarId: true,
      syncToken: true,
    },
  });

  for (const calendar of calendars) {
    try {
      await pullOneCalendar(account, adapter, calendar);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.calendar.update({
        where: { id: calendar.id },
        data: { lastError: message },
      });
      console.error(
        `[calendar-sync-worker] Calendar ${calendar.id} failed:`,
        err,
      );
    }
  }
}

export async function processCalendarSyncJob(
  data: CalendarSyncJobData,
): Promise<void> {
  if (isDemoInstance()) return;

  const { calendarAccountId, userId } = data;

  const locked = await claimCalendarSyncLock(calendarAccountId);
  if (!locked) {
    console.log(
      `[calendar-sync-worker] Lock held for ${calendarAccountId}, skipping`,
    );
    return;
  }

  try {
    const account = await db.calendarAccount.findUnique({
      where: { id: calendarAccountId, userId },
    });
    if (!account) {
      await releaseCalendarSyncLock(calendarAccountId, "Account not found");
      return;
    }

    await syncAccount(account);
    await releaseCalendarSyncLock(calendarAccountId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseCalendarSyncLock(calendarAccountId, message);
    if (err instanceof CalendarOauthError) return;
    throw err;
  }
}

let calendarSyncWorker: Worker | null = null;

export async function startCalendarSyncWorker(): Promise<void> {
  if (calendarSyncWorker) return;

  calendarSyncWorker = new Worker<CalendarSyncJobData>(
    CALENDAR_SYNC_QUEUE,
    (job) => processCalendarSyncJob(job.data),
    {
      connection: getRedisConnection(),
      concurrency: 5,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  calendarSyncWorker.on("failed", (job, err) => {
    console.error(
      `[calendar-sync-worker] Job ${job?.id} failed:`,
      err.message,
    );
  });

  console.log("[calendar-sync-worker] Started with concurrency 5");
}

export const CALENDAR_SYNC_EVERY_MS = 120_000;

const CALENDAR_SYNC_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 10_000 },
};

/** Repeatable job plus optional one-shot so a new account syncs immediately. */
export async function enqueueCalendarSyncJob(
  accountId: string,
  userId: string,
  options: { immediate?: boolean } = {},
): Promise<void> {
  const queue = getCalendarSyncQueue();
  const data: CalendarSyncJobData = { calendarAccountId: accountId, userId };
  await queue.add("sync", data, {
    ...CALENDAR_SYNC_JOB_OPTS,
    jobId: `calendar-sync-${accountId}`,
    repeat: { every: CALENDAR_SYNC_EVERY_MS },
  });
  if (options.immediate) {
    await queue.add("sync", data, CALENDAR_SYNC_JOB_OPTS);
  }
}

export async function unscheduleCalendarSyncJob(
  accountId: string,
): Promise<void> {
  const queue = getCalendarSyncQueue();
  await queue.removeRepeatable(
    "sync",
    { every: CALENDAR_SYNC_EVERY_MS },
    `calendar-sync-${accountId}`,
  );
}

/**
 * Schedule repeatable sync jobs for all calendar accounts.
 * Called once at startup, then whenever a new account is connected.
 */
export async function scheduleCalendarSyncJobs(): Promise<void> {
  const accounts = await db.calendarAccount.findMany({
    select: { id: true, userId: true },
  });

  for (const account of accounts) {
    await enqueueCalendarSyncJob(account.id, account.userId);
  }

  console.log(
    `[calendar-sync-worker] Scheduled ${accounts.length} calendar sync jobs`,
  );
}

export async function stopCalendarSyncWorker(): Promise<void> {
  if (calendarSyncWorker) {
    await calendarSyncWorker.close();
    calendarSyncWorker = null;
    console.log("[calendar-sync-worker] Stopped");
  }
}
