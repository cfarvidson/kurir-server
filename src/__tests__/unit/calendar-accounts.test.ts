import { describe, it, expect, vi, beforeEach } from "vitest";

const { davMocks, jobMocks, dnsMocks } = vi.hoisted(() => ({
  davMocks: {
    createAccount: vi.fn(),
    getBasicAuthHeaders: vi.fn(() => ({ authorization: "Basic x" })),
  },
  jobMocks: {
    enqueueCalendarSyncJob: vi.fn(),
    unscheduleCalendarSyncJob: vi.fn(),
  },
  dnsMocks: {
    lookup: vi.fn(),
  },
}));

vi.mock("node:dns/promises", () => ({
  lookup: dnsMocks.lookup,
}));

vi.mock("tsdav", () => ({
  createAccount: davMocks.createAccount,
  getBasicAuthHeaders: davMocks.getBasicAuthHeaders,
}));

vi.mock("@/lib/jobs/calendar-sync-worker", () => ({
  enqueueCalendarSyncJob: jobMocks.enqueueCalendarSyncJob,
  unscheduleCalendarSyncJob: jobMocks.unscheduleCalendarSyncJob,
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarAccount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    calendarEvent: { findMany: vi.fn() },
    calendarTombstone: { createMany: vi.fn() },
    calendar: { findFirst: vi.fn(), update: vi.fn() },
    emailConnection: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import {
  createCalDavAccount,
  deleteCalendarAccount,
} from "@/lib/calendar/accounts";

describe("createCalDavAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dnsMocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("discovers calendar-home then inserts and enqueues sync", async () => {
    davMocks.createAccount.mockResolvedValue({
      homeUrl: "https://caldav.icloud.com/calendars/user/",
    });
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue(null);
    vi.mocked(db.calendarAccount.create).mockResolvedValue({
      id: "acc-1",
    } as never);

    const account = await createCalDavAccount({
      userId: "u1",
      url: "caldav.icloud.com",
      username: "user@icloud.com",
      password: "app-pass",
    });

    expect(davMocks.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          serverUrl: "https://caldav.icloud.com",
          accountType: "caldav",
        }),
      }),
    );
    expect(db.calendarAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        provider: "CALDAV",
        caldavUrl: "https://caldav.icloud.com/calendars/user/",
        caldavUsername: "user@icloud.com",
        encryptedPassword: "enc:app-pass",
        principalEmail: "user@icloud.com",
      }),
      select: { id: true },
    });
    expect(jobMocks.enqueueCalendarSyncJob).toHaveBeenCalledWith(
      "acc-1",
      "u1",
      { immediate: true },
    );
    expect(account).toEqual({ id: "acc-1" });
  });

  it("updates the named account even when username and home would not match", async () => {
    davMocks.createAccount.mockResolvedValue({
      homeUrl: "https://caldav.example.com/home/",
    });
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue({
      id: "acc-old",
    } as never);
    vi.mocked(db.calendarAccount.update).mockResolvedValue({
      id: "acc-old",
    } as never);

    const account = await createCalDavAccount({
      userId: "u1",
      url: "https://caldav.example.com",
      username: "new-user",
      password: "new-pass",
      accountId: "acc-old",
    });

    expect(db.calendarAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-old", userId: "u1", provider: "CALDAV" },
      select: { id: true },
    });
    expect(db.calendarAccount.create).not.toHaveBeenCalled();
    expect(db.calendarAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-old" },
      data: expect.objectContaining({
        caldavUrl: "https://caldav.example.com/home/",
        caldavUsername: "new-user",
        encryptedPassword: "enc:new-pass",
        lastError: null,
      }),
      select: { id: true },
    });
    expect(jobMocks.enqueueCalendarSyncJob).toHaveBeenCalledWith(
      "acc-old",
      "u1",
      { immediate: true },
    );
    expect(account).toEqual({ id: "acc-old" });
  });

  it("rejects reconnect of a missing CalDAV account before discovery", async () => {
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue(null);

    await expect(
      createCalDavAccount({
        userId: "u1",
        url: "https://caldav.example.com",
        username: "user",
        password: "pass",
        accountId: "missing",
      }),
    ).rejects.toThrow("Calendar account not found");

    expect(davMocks.createAccount).not.toHaveBeenCalled();
    expect(db.calendarAccount.create).not.toHaveBeenCalled();
    expect(db.calendarAccount.update).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/",
    "https://localhost/",
  ])("refuses private destination %s before tsdav", async (url) => {
    await expect(
      createCalDavAccount({
        userId: "u1",
        url,
        username: "user",
        password: "pass",
      }),
    ).rejects.toThrow(/That URL is not allowed/);

    expect(davMocks.createAccount).not.toHaveBeenCalled();
    expect(dnsMocks.lookup).not.toHaveBeenCalled();
  });
});

describe("deleteCalendarAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tombstones remaining masters, deletes the account, unschedules the job", async () => {
    const tx = {
      calendarAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: "acc-1" }),
        delete: vi.fn(),
      },
      calendarEvent: {
        findMany: vi.fn().mockResolvedValue([
          { id: "evt-1", providerEventId: "prov-1" },
          { id: "evt-2", providerEventId: "prov-2" },
        ]),
      },
      calendarTombstone: { createMany: vi.fn() },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) => {
      await (fn as unknown as (client: typeof tx) => Promise<void>)(tx);
    });

    await deleteCalendarAccount("u1", "acc-1");

    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(tx.calendarAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", userId: "u1" },
      select: { id: true },
    });
    expect(tx.calendarEvent.findMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        masterEventId: null,
        recurrenceId: null,
        calendar: { accountId: "acc-1" },
      },
      select: { id: true, providerEventId: true },
    });
    expect(tx.calendarTombstone.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: "evt-1", providerEventId: "prov-1", userId: "u1" },
        { eventId: "evt-2", providerEventId: "prov-2", userId: "u1" },
      ],
      skipDuplicates: true,
    });
    expect(tx.calendarAccount.delete).toHaveBeenCalledWith({
      where: { id: "acc-1" },
    });
    expect(jobMocks.unscheduleCalendarSyncJob).toHaveBeenCalledWith("acc-1");
  });
});
