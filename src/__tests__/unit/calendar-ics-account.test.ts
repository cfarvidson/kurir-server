import { describe, it, expect, vi, beforeEach } from "vitest";

const { jobMocks, dnsMocks, pinnedMocks } = vi.hoisted(() => ({
  jobMocks: {
    enqueueCalendarSyncJob: vi.fn(),
    unscheduleCalendarSyncJob: vi.fn(),
  },
  dnsMocks: {
    lookup: vi.fn(),
  },
  pinnedMocks: {
    fetchPinned: vi.fn(),
  },
}));

vi.mock("node:dns/promises", () => ({
  lookup: dnsMocks.lookup,
}));

vi.mock("@/lib/calendar/ics-pinned", () => ({
  fetchPinned: pinnedMocks.fetchPinned,
}));

vi.mock("@/lib/jobs/calendar-sync-worker", () => ({
  enqueueCalendarSyncJob: jobMocks.enqueueCalendarSyncJob,
  unscheduleCalendarSyncJob: jobMocks.unscheduleCalendarSyncJob,
}));

vi.mock("@/lib/demo", () => ({
  isDemoInstance: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    calendarAccount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    calendar: {
      upsert: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import { icsAddressIsBlocked } from "@/lib/calendar/ics-account";
import { createIcsAccount } from "@/lib/calendar/ics-account";

const NAMED_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test
X-WR-CALNAME:School term
BEGIN:VEVENT
UID:inset-1
DTSTART;VALUE=DATE:20260901
DTEND;VALUE=DATE:20260902
SUMMARY:Inset day
END:VEVENT
END:VCALENDAR`;

const EMPTY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test
END:VCALENDAR`;

function publicLookup() {
  dnsMocks.lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
}

function jsonResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/calendar", ...headers },
  });
}

describe("icsAddressIsBlocked", () => {
  it("refuses loopback, RFC1918, link-local, metadata and unique-local", () => {
    expect(icsAddressIsBlocked("127.0.0.1")).toBe(true);
    expect(icsAddressIsBlocked("10.0.0.4")).toBe(true);
    expect(icsAddressIsBlocked("172.16.1.1")).toBe(true);
    expect(icsAddressIsBlocked("192.168.1.1")).toBe(true);
    expect(icsAddressIsBlocked("169.254.1.1")).toBe(true);
    expect(icsAddressIsBlocked("169.254.169.254")).toBe(true);
    expect(icsAddressIsBlocked("::1")).toBe(true);
    expect(icsAddressIsBlocked("fe80::1")).toBe(true);
    expect(icsAddressIsBlocked("fd12:3456::1")).toBe(true);
    expect(icsAddressIsBlocked("::ffff:127.0.0.1")).toBe(true);
    expect(icsAddressIsBlocked("93.184.216.34")).toBe(false);
  });
});

describe("createIcsAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicLookup();
    vi.mocked(isDemoInstance).mockReturnValue(false);
  });

  it("stores an ICS account, names it from X-WR-CALNAME and enqueues sync", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, NAMED_ICS));
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue(null);
    vi.mocked(db.calendarAccount.create).mockResolvedValue({
      id: "acc-ics",
    } as never);
    vi.mocked(db.calendar.upsert).mockResolvedValue({} as never);

    const account = await createIcsAccount({
      userId: "u1",
      url: "webcal://school.example/term.ics",
    });

    expect(db.calendarAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        provider: "ICS",
        displayName: "School term",
        principalEmail: null,
        caldavUrl: "https://school.example/term.ics",
        caldavUsername: null,
        encryptedPassword: null,
        lastError: null,
      }),
      select: { id: true },
    });
    expect(db.calendar.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: "School term",
          isReadOnly: true,
          isPrimary: true,
        }),
      }),
    );
    expect(jobMocks.enqueueCalendarSyncJob).toHaveBeenCalledWith(
      "acc-ics",
      "u1",
      { immediate: true },
    );
    expect(account).toEqual({ id: "acc-ics" });
  });

  it("uses the host when the feed has no name", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, EMPTY_ICS));
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue(null);
    vi.mocked(db.calendarAccount.create).mockResolvedValue({
      id: "acc-2",
    } as never);
    vi.mocked(db.calendar.upsert).mockResolvedValue({} as never);

    await createIcsAccount({
      userId: "u1",
      url: "https://holidays.example/se.ics",
    });

    expect(db.calendarAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayName: "holidays.example" }),
      select: { id: true },
    });
  });

  it("upserts the same canonical URL instead of inserting a twin", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, NAMED_ICS));
    vi.mocked(db.calendarAccount.findFirst).mockResolvedValue({
      id: "acc-existing",
    } as never);
    vi.mocked(db.calendarAccount.update).mockResolvedValue({
      id: "acc-existing",
    } as never);
    vi.mocked(db.calendar.upsert).mockResolvedValue({} as never);

    const account = await createIcsAccount({
      userId: "u1",
      url: "https://school.example/term.ics/",
    });

    expect(db.calendarAccount.create).not.toHaveBeenCalled();
    expect(db.calendarAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-existing" },
      data: expect.objectContaining({ lastError: null }),
      select: { id: true },
    });
    expect(account).toEqual({ id: "acc-existing" });
  });

  it("fails connect on HTML or garbage and does not insert", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(
      jsonResponse(200, "<html>not a calendar</html>"),
    );

    await expect(
      createIcsAccount({ userId: "u1", url: "https://example.com/page" }),
    ).rejects.toThrow(/not a calendar/i);

    expect(db.calendarAccount.create).not.toHaveBeenCalled();
    expect(jobMocks.enqueueCalendarSyncJob).not.toHaveBeenCalled();
  });

  it("fails with a needs-auth message on 401 from the feed", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(401, "login"));

    await expect(
      createIcsAccount({ userId: "u1", url: "https://example.com/secret.ics" }),
    ).rejects.toThrow(/no login/i);

    expect(db.calendarAccount.create).not.toHaveBeenCalled();
  });

  it("refuses a loopback host before fetching", async () => {
    dnsMocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await expect(
      createIcsAccount({ userId: "u1", url: "https://localhost/cal.ics" }),
    ).rejects.toThrow(/not allowed/i);

    expect(pinnedMocks.fetchPinned).not.toHaveBeenCalled();
    expect(db.calendarAccount.create).not.toHaveBeenCalled();
  });

  it("refuses a redirect onto loopback", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/cal.ics" },
      }),
    );

    await expect(
      createIcsAccount({
        userId: "u1",
        url: "https://example.com/redirect.ics",
      }),
    ).rejects.toThrow(/not allowed/i);

    expect(db.calendarAccount.create).not.toHaveBeenCalled();
  });

  it("does not fetch on a demo instance", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);

    await expect(
      createIcsAccount({ userId: "u1", url: "https://example.com/cal.ics" }),
    ).rejects.toThrow(/demo/i);

    expect(pinnedMocks.fetchPinned).not.toHaveBeenCalled();
    expect(dnsMocks.lookup).not.toHaveBeenCalled();
  });
});
