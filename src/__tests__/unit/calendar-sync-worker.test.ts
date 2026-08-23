import { describe, it, expect, vi, beforeEach } from "vitest";

const { adapter } = vi.hoisted(() => {
  const adapter = {
    listCalendars: vi.fn(),
    pull: vi.fn(),
    getEvent: vi.fn(),
    moveEvent: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    respond: vi.fn(),
  };
  return { adapter };
});

vi.mock("@/lib/demo", () => ({
  isDemoInstance: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    calendar: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/calendar/sync-lock", () => ({
  claimCalendarSyncLock: vi.fn(async () => true),
  heartbeatCalendarSyncLock: vi.fn(),
  releaseCalendarSyncLock: vi.fn(),
}));

vi.mock("@/lib/calendar/apply-pull", () => ({
  applyPull: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn((value: string) => value),
}));

vi.mock("@/lib/calendar/providers/google", () => ({
  createGoogleAdapter: vi.fn(() => adapter),
}));

vi.mock("@/lib/calendar/providers/microsoft", () => ({
  createMicrosoftAdapter: vi.fn(() => adapter),
}));

vi.mock("@/lib/calendar/providers/caldav", () => ({
  createCalDavAdapter: vi.fn(() => adapter),
}));

vi.mock("@/lib/jobs/queue", () => ({
  CALENDAR_SYNC_QUEUE: "sync-calendar",
  getCalendarSyncQueue: vi.fn(),
  getRedisConnection: vi.fn(() => ({})),
  Worker: vi.fn(),
}));

import { isDemoInstance } from "@/lib/demo";
import { db } from "@/lib/db";
import {
  claimCalendarSyncLock,
  releaseCalendarSyncLock,
} from "@/lib/calendar/sync-lock";
import { createGoogleAdapter } from "@/lib/calendar/providers/google";
import { createMicrosoftAdapter } from "@/lib/calendar/providers/microsoft";
import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";

function googleAccount() {
  return {
    id: "acc-1",
    userId: "u1",
    provider: "GOOGLE" as const,
    oauthAccessToken: "tok-1",
    oauthRefreshToken: "ref-1",
    oauthTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    caldavUrl: null,
    caldavUsername: null,
    encryptedPassword: null,
    calendars: [],
  };
}

describe("processCalendarSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits in demo without calling the adapter", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);
    vi.mocked(db.calendarAccount.findUnique).mockResolvedValue({
      id: "acc-1",
      userId: "u1",
      provider: "GOOGLE",
      oauthAccessToken: "tok-1",
      oauthRefreshToken: "ref-1",
      oauthTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      caldavUrl: null,
      caldavUsername: null,
      encryptedPassword: null,
      calendars: [],
    } as never);

    const { processCalendarSyncJob } = await import(
      "@/lib/jobs/calendar-sync-worker"
    );
    await processCalendarSyncJob({
      calendarAccountId: "acc-1",
      userId: "u1",
    });

    expect(createGoogleAdapter).not.toHaveBeenCalled();
    expect(createMicrosoftAdapter).not.toHaveBeenCalled();
    expect(createCalDavAdapter).not.toHaveBeenCalled();
    expect(claimCalendarSyncLock).not.toHaveBeenCalled();
    expect(adapter.listCalendars).not.toHaveBeenCalled();
    expect(adapter.pull).not.toHaveBeenCalled();
  });

  it("does not hide local calendars when listCalendars returns empty", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(false);
    vi.mocked(claimCalendarSyncLock).mockResolvedValue(true);
    vi.mocked(db.calendarAccount.findUnique).mockResolvedValue(
      googleAccount() as never,
    );
    adapter.listCalendars.mockResolvedValue([]);

    const { processCalendarSyncJob } = await import(
      "@/lib/jobs/calendar-sync-worker"
    );
    await processCalendarSyncJob({
      calendarAccountId: "acc-1",
      userId: "u1",
    });

    expect(createGoogleAdapter).toHaveBeenCalled();
    expect(adapter.listCalendars).toHaveBeenCalledTimes(1);
    expect(db.calendar.updateMany).not.toHaveBeenCalled();
    expect(db.calendar.upsert).not.toHaveBeenCalled();
    expect(adapter.pull).not.toHaveBeenCalled();
    expect(releaseCalendarSyncLock).toHaveBeenCalledWith("acc-1");
  });

  it("prunes vanished event-less calendars alongside the soft-hide", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(false);
    vi.mocked(claimCalendarSyncLock).mockResolvedValue(true);
    vi.mocked(db.calendarAccount.findUnique).mockResolvedValue(
      googleAccount() as never,
    );
    adapter.listCalendars.mockResolvedValue([
      {
        providerCalendarId: "remote-cal-1",
        name: "Remote",
        color: null,
        isPrimary: true,
        isReadOnly: false,
        timezone: null,
      },
    ]);
    vi.mocked(db.calendar.findMany).mockResolvedValue([] as never);

    const { processCalendarSyncJob } = await import(
      "@/lib/jobs/calendar-sync-worker"
    );
    await processCalendarSyncJob({
      calendarAccountId: "acc-1",
      userId: "u1",
    });

    expect(db.calendar.updateMany).toHaveBeenCalledWith({
      where: {
        accountId: "acc-1",
        providerCalendarId: { notIn: ["remote-cal-1"] },
      },
      data: { isVisible: false },
    });
    expect(db.calendar.deleteMany).toHaveBeenCalledWith({
      where: {
        accountId: "acc-1",
        providerCalendarId: { notIn: ["remote-cal-1"] },
        events: { none: {} },
      },
    });
    expect(releaseCalendarSyncLock).toHaveBeenCalledWith("acc-1");
  });
});
