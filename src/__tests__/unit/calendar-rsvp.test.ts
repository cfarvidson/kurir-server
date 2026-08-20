import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RemoteEvent } from "@/lib/calendar/providers/types";

const { adapter, sendItipReply } = vi.hoisted(() => ({
  adapter: {
    respond: vi.fn(),
  },
  sendItipReply: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    messageMeeting: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    calendar: {
      findMany: vi.fn(),
    },
    calendarEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("@/lib/demo", () => ({
  isDemoInstance: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/calendar/write", () => ({
  createEventForUser: vi.fn(),
  CalendarWriteError: class CalendarWriteError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "CalendarWriteError";
    }
  },
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

vi.mock("@/lib/calendar/itip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/itip")>();
  return { ...actual, sendItipReply };
});

vi.mock("@/lib/mail/send", () => ({
  sendMailForUser: vi.fn(),
}));

import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import { getConnectionCredentials } from "@/lib/auth";
import { createEventForUser } from "@/lib/calendar/write";
import { createGoogleAdapter } from "@/lib/calendar/providers/google";
import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";
import { sendMailForUser } from "@/lib/mail/send";
import { buildItipReply } from "@/lib/calendar/itip";
import { rsvpToMeetingForUser } from "@/lib/calendar/rsvp";

const START = new Date("2026-08-20T14:00:00.000Z");
const END = new Date("2026-08-20T15:00:00.000Z");
const RECURRENCE = new Date("2026-08-20T14:00:00.000Z");

const smtpCreds = {
  email: "me@x.y",
  sendAsEmail: null as string | null,
  aliases: [] as string[],
  treatDomainAsOwn: false,
  password: "pw",
  accessToken: null as string | null,
  oauthProvider: null as string | null,
  imap: { host: "imap.example.com", port: 993 },
  smtp: { host: "smtp.example.com", port: 587 },
};

function googleAccount(partial: Record<string, unknown> = {}) {
  return {
    id: "acc-g",
    provider: "GOOGLE" as const,
    principalEmail: "me@x.y",
    oauthAccessToken: "tok-g",
    caldavUrl: null,
    caldavUsername: null,
    encryptedPassword: null,
    ...partial,
  };
}

function caldavAccount(partial: Record<string, unknown> = {}) {
  return {
    id: "acc-d",
    provider: "CALDAV" as const,
    principalEmail: "me@x.y",
    oauthAccessToken: null,
    caldavUrl: "https://cal.example",
    caldavUsername: "me@x.y",
    encryptedPassword: "pw-d",
    ...partial,
  };
}

function googleCal(partial: Record<string, unknown> = {}) {
  return {
    id: "cal-g",
    isReadOnly: false,
    isPrimary: true,
    isVisible: true,
    providerCalendarId: "primary",
    account: googleAccount(),
    ...partial,
  };
}

function caldavCal(partial: Record<string, unknown> = {}) {
  return {
    id: "cal-d",
    isReadOnly: false,
    isPrimary: true,
    isVisible: true,
    providerCalendarId: "https://cal.example/home/cal/",
    account: caldavAccount(),
    ...partial,
  };
}

function meeting(partial: Record<string, unknown> = {}) {
  return {
    id: "mm-1",
    uid: "g-uid-1@google.com",
    method: "REQUEST",
    title: "Design review",
    startAt: START,
    endAt: END,
    isAllDay: false,
    location: "Room 4",
    organizerEmail: "ada@x.y",
    organizerName: "Ada",
    recurrenceId: null,
    calendarEventId: null,
    messageId: "msg-1",
    userId: "user-1",
    message: {
      emailConnectionId: "conn-1",
      emailConnection: {
        email: "me@x.y",
        aliases: [] as string[],
        sendAsEmail: null as string | null,
      },
    },
    ...partial,
  };
}

function eventRow(
  calendar: ReturnType<typeof googleCal>,
  partial: Record<string, unknown> = {},
) {
  return {
    id: "evt-1",
    providerEventId: "g-1",
    icalUid: "g-uid-1@google.com",
    etag: "etag-1",
    sequence: 0,
    title: "Design review",
    description: null,
    location: "Room 4",
    startAt: START,
    endAt: END,
    isAllDay: false,
    timezone: null,
    status: "confirmed",
    transparency: "busy",
    rrule: null,
    rdate: null,
    exdate: null,
    masterEventId: null,
    recurrenceId: null,
    organizerJson: null,
    attendeesJson: null,
    rawJson: null,
    calendarId: calendar.id,
    userId: "user-1",
    calendar,
    ...partial,
  };
}

function remote(partial: Partial<RemoteEvent> = {}): RemoteEvent {
  return {
    providerEventId: "g-1",
    icalUid: "g-uid-1@google.com",
    etag: "etag-2",
    sequence: 1,
    title: "Design review",
    description: null,
    location: "Room 4",
    startAt: START,
    endAt: END,
    isAllDay: false,
    timezone: null,
    status: "confirmed",
    transparency: "busy",
    rrule: null,
    rdate: null,
    exdate: null,
    masterProviderEventId: null,
    recurrenceId: null,
    organizerJson: { email: "ada@x.y" },
    attendeesJson: [{ email: "me@x.y", responseStatus: "accepted", self: true }],
    rawJson: { id: "g-1" },
    ...partial,
  };
}

describe("rsvpToMeetingForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
    vi.mocked(db.messageMeeting.update).mockResolvedValue({} as never);
    vi.mocked(db.calendarEvent.update).mockResolvedValue({} as never);
    vi.mocked(db.calendarEvent.create).mockResolvedValue({ id: "evt-demo" } as never);
    vi.mocked(getConnectionCredentials).mockResolvedValue(smtpCreds as never);
    adapter.respond.mockResolvedValue(remote());
    sendItipReply.mockResolvedValue(undefined);
  });

  it("Google path responds via adapter and does not send iTIP", async () => {
    const cal = googleCal();
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(meeting() as never);
    vi.mocked(db.calendar.findMany).mockResolvedValue([cal] as never);
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue(
      eventRow(cal) as never,
    );

    await rsvpToMeetingForUser("user-1", "msg-1", "accepted");

    expect(createGoogleAdapter).toHaveBeenCalled();
    expect(adapter.respond).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      { providerEventId: "g-1" },
      "accepted",
    );
    expect(createEventForUser).not.toHaveBeenCalled();
    expect(sendItipReply).not.toHaveBeenCalled();
    expect(getConnectionCredentials).not.toHaveBeenCalled();
    expect(sendMailForUser).not.toHaveBeenCalled();
  });

  it("CalDAV path responds via adapter and sends iTIP over SMTP", async () => {
    const cal = caldavCal();
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(meeting() as never);
    vi.mocked(db.calendar.findMany).mockResolvedValue([cal] as never);
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue(
      eventRow(cal, { providerEventId: "https://cal.example/home/cal/g-uid-1.ics" }) as never,
    );

    await rsvpToMeetingForUser("user-1", "msg-1", "accepted");

    expect(createCalDavAdapter).toHaveBeenCalled();
    expect(adapter.respond).toHaveBeenCalledWith(
      { providerCalendarId: "https://cal.example/home/cal/" },
      { providerEventId: "https://cal.example/home/cal/g-uid-1.ics" },
      "accepted",
    );
    expect(getConnectionCredentials).toHaveBeenCalledWith("conn-1", "user-1");
    expect(sendItipReply).toHaveBeenCalledTimes(1);
    expect(sendItipReply).toHaveBeenCalledWith(
      smtpCreds,
      expect.objectContaining({
        uid: "g-uid-1@google.com",
        title: "Design review",
        organizerEmail: "ada@x.y",
        attendeeEmail: "me@x.y",
        status: "accepted",
      }),
    );
    expect(sendMailForUser).not.toHaveBeenCalled();
  });

  it("creates the event from ICS fields then responds when UID is missing", async () => {
    const cal = googleCal();
    const created = eventRow(cal, { id: "evt-new", providerEventId: "g-new" });
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(meeting() as never);
    vi.mocked(db.calendar.findMany).mockResolvedValue([cal] as never);
    vi.mocked(createEventForUser).mockResolvedValue({ id: "evt-new" });

    let createdOnProvider = false;
    vi.mocked(createEventForUser).mockImplementation(async () => {
      createdOnProvider = true;
      return { id: "evt-new" };
    });
    vi.mocked(db.calendarEvent.findFirst).mockImplementation(async () => {
      if (!createdOnProvider) return null as never;
      return created as never;
    });

    await rsvpToMeetingForUser("user-1", "msg-1", "tentative");

    expect(createEventForUser).toHaveBeenCalledWith("user-1", "cal-g", {
      title: "Design review",
      description: null,
      location: "Room 4",
      startAt: START,
      endAt: END,
      isAllDay: false,
      timezone: null,
      rrule: null,
    });
    expect(adapter.respond).toHaveBeenCalledWith(
      { providerCalendarId: "primary" },
      { providerEventId: "g-new" },
      "tentative",
    );
    expect(sendItipReply).not.toHaveBeenCalled();
  });

  it("throws Connect a calendar to reply. when nothing is writable", async () => {
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(meeting() as never);
    vi.mocked(db.calendar.findMany).mockResolvedValue([
      googleCal({ id: "cal-ro", isReadOnly: true, isVisible: true }),
    ] as never);

    await expect(
      rsvpToMeetingForUser("user-1", "msg-1", "accepted"),
    ).rejects.toThrow("Connect a calendar to reply.");

    expect(createEventForUser).not.toHaveBeenCalled();
    expect(adapter.respond).not.toHaveBeenCalled();
    expect(sendItipReply).not.toHaveBeenCalled();
  });

  it("RSVPs this occurrence when recurrenceId is set", async () => {
    const cal = caldavCal();
    const exception = eventRow(cal, {
      id: "evt-this",
      providerEventId: "https://cal.example/home/cal/g-uid-1-this.ics",
      recurrenceId: RECURRENCE,
    });
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(
      meeting({ recurrenceId: RECURRENCE }) as never,
    );
    vi.mocked(db.calendar.findMany).mockResolvedValue([cal] as never);
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue(exception as never);

    await rsvpToMeetingForUser("user-1", "msg-1", "declined");

    expect(adapter.respond).toHaveBeenCalledWith(
      { providerCalendarId: "https://cal.example/home/cal/" },
      { providerEventId: "https://cal.example/home/cal/g-uid-1-this.ics" },
      "declined",
    );
    expect(sendItipReply).toHaveBeenCalledWith(
      smtpCreds,
      expect.objectContaining({
        status: "declined",
        recurrenceId: RECURRENCE,
      }),
    );
  });

  it("demo instance updates the replica only", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);
    const cal = googleCal();
    vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(meeting() as never);
    vi.mocked(db.calendar.findMany).mockResolvedValue([cal] as never);
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue(null);

    await rsvpToMeetingForUser("user-1", "msg-1", "accepted");

    expect(createEventForUser).not.toHaveBeenCalled();
    expect(adapter.respond).not.toHaveBeenCalled();
    expect(sendItipReply).not.toHaveBeenCalled();
    expect(getConnectionCredentials).not.toHaveBeenCalled();
    expect(db.calendarEvent.create).toHaveBeenCalled();
    expect(createGoogleAdapter).not.toHaveBeenCalled();
  });
});

describe("buildItipReply", () => {
  it("builds a METHOD:REPLY with PARTSTAT and organizer", () => {
    const ics = buildItipReply({
      uid: "g-uid-1@google.com",
      title: "Design review",
      startAt: START,
      endAt: END,
      isAllDay: false,
      organizerEmail: "ada@x.y",
      attendeeEmail: "me@x.y",
      status: "accepted",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REPLY");
    expect(ics).toContain("UID:g-uid-1@google.com");
    expect(ics).toContain("PARTSTAT=ACCEPTED");
    expect(ics).toContain("mailto:me@x.y");
    expect(ics).toContain("ORGANIZER");
    expect(ics).toContain("mailto:ada@x.y");
    expect(ics).not.toContain("RECURRENCE-ID");
  });

  it("includes RECURRENCE-ID for this-occurrence replies", () => {
    const ics = buildItipReply({
      uid: "recur-1@google.com",
      title: "Weekly sync",
      startAt: START,
      endAt: END,
      isAllDay: false,
      organizerEmail: "ada@x.y",
      attendeeEmail: "me@x.y",
      status: "tentative",
      recurrenceId: RECURRENCE,
    });

    expect(ics).toContain("METHOD:REPLY");
    expect(ics).toContain("PARTSTAT=TENTATIVE");
    expect(ics).toMatch(/RECURRENCE-ID[^:]*:20260820T140000Z/);
  });
});
