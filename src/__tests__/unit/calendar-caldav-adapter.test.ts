import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { instanceWindow } from "@/lib/calendar/expand";
import { CalendarConflictError } from "@/lib/calendar/providers/types";

const { davMocks } = vi.hoisted(() => {
  const fetchCalendars = vi.fn();
  const syncCollection = vi.fn();
  const calendarQuery = vi.fn();
  const calendarMultiGet = vi.fn();
  const createCalendarObject = vi.fn();
  const updateCalendarObject = vi.fn();
  const deleteCalendarObject = vi.fn();
  const fetchCalendarObjects = vi.fn();
  const createDAVClient = vi.fn();
  return {
    davMocks: {
      createDAVClient,
      fetchCalendars,
      syncCollection,
      calendarQuery,
      calendarMultiGet,
      createCalendarObject,
      updateCalendarObject,
      deleteCalendarObject,
      fetchCalendarObjects,
    },
  };
});

vi.mock("tsdav", () => ({
  createDAVClient: davMocks.createDAVClient,
}));

import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";

const SERVER_URL = "https://caldav.example.com";
const CAL_URL = "https://caldav.example.com/calendars/user/home/";
const EVENT_HREF = "https://caldav.example.com/calendars/user/home/e1.ics";

const timedIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:e1
SUMMARY:Call
DTSTART:20260820T140000Z
DTEND:20260820T150000Z
ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:user@example.com
END:VEVENT
END:VCALENDAR`;

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function mockClient() {
  return {
    fetchCalendars: davMocks.fetchCalendars,
    syncCollection: davMocks.syncCollection,
    calendarQuery: davMocks.calendarQuery,
    calendarMultiGet: davMocks.calendarMultiGet,
    createCalendarObject: davMocks.createCalendarObject,
    updateCalendarObject: davMocks.updateCalendarObject,
    deleteCalendarObject: davMocks.deleteCalendarObject,
    fetchCalendarObjects: davMocks.fetchCalendarObjects,
  };
}

function adapter() {
  return createCalDavAdapter({
    url: SERVER_URL,
    username: "user@example.com",
    password: "app-pass",
  });
}

const eventInput = {
  title: "Call 2",
  description: null,
  location: null,
  startAt: new Date("2026-08-20T14:00:00.000Z"),
  endAt: new Date("2026-08-20T15:00:00.000Z"),
  isAllDay: false,
  timezone: "UTC",
  rrule: null,
};

describe("createCalDavAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.createDAVClient.mockResolvedValue(mockClient());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists calendars after discovering .well-known/caldav and calendar-home", async () => {
    davMocks.fetchCalendars.mockResolvedValue([
      {
        url: CAL_URL,
        displayName: "Personal",
        calendarColor: "#ff0000",
        timezone: "UTC",
      },
      {
        url: "https://caldav.example.com/calendars/user/holidays/",
        displayName: "Holidays",
      },
    ]);

    const calendars = await adapter().listCalendars();

    expect(davMocks.createDAVClient).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: SERVER_URL,
        credentials: {
          username: "user@example.com",
          password: "app-pass",
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      }),
    );
    expect(davMocks.fetchCalendars).toHaveBeenCalled();
    expect(calendars).toEqual([
      {
        providerCalendarId: CAL_URL,
        name: "Personal",
        color: "#ff0000",
        isPrimary: true,
        isReadOnly: false,
        timezone: "UTC",
      },
      {
        providerCalendarId:
          "https://caldav.example.com/calendars/user/holidays/",
        name: "Holidays",
        color: null,
        isPrimary: false,
        isReadOnly: false,
        timezone: null,
      },
    ]);
  });

  it("pulls incremental syncCollection without delete-missing complete", async () => {
    davMocks.syncCollection.mockResolvedValue([
      {
        href: EVENT_HREF,
        status: 200,
        ok: true,
        props: {
          getetag: '"etag1"',
          calendarData: timedIcs,
        },
        raw: { multistatus: { syncToken: "sync-2" } },
      },
      {
        href: "https://caldav.example.com/calendars/user/home/e2.ics",
        status: 404,
        ok: false,
      },
    ]);

    const result = await adapter().pull(
      { providerCalendarId: CAL_URL, syncToken: "sync-1" },
      null,
    );

    expect(davMocks.syncCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        url: CAL_URL,
        syncLevel: 1,
        syncToken: "sync-1",
      }),
    );
    expect(davMocks.calendarQuery).not.toHaveBeenCalled();
    expect(result.reset).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.cursor).toBe("sync-2");
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]?.providerEventId).toBe(EVENT_HREF);
    expect(result.upserts[0]?.title).toBe("Call");
    expect(result.upserts[0]?.etag).toBe('"etag1"');
    expect(result.deletedProviderIds).toEqual([
      "https://caldav.example.com/calendars/user/home/e2.ics",
    ]);
  });

  it("falls back to calendarQuery over instanceWindow with complete false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-08-20T12:00:00.000Z");
    vi.setSystemTime(now);
    const window = instanceWindow(now);

    davMocks.syncCollection.mockResolvedValue([
      { status: 501, ok: false, statusText: "Not Implemented" },
    ]);
    davMocks.calendarQuery.mockResolvedValue([
      {
        href: EVENT_HREF,
        status: 200,
        ok: true,
        props: {
          getetag: '"etag1"',
          calendarData: timedIcs,
        },
      },
    ]);

    const result = await adapter().pull(
      { providerCalendarId: CAL_URL, syncToken: null },
      null,
    );

    expect(davMocks.syncCollection).toHaveBeenCalled();
    expect(davMocks.calendarQuery).toHaveBeenCalledTimes(1);
    const queryArg = davMocks.calendarQuery.mock.calls[0]?.[0] as {
      url: string;
      depth?: string;
      filters?: unknown;
    };
    expect(queryArg.url).toBe(CAL_URL);
    expect(queryArg.depth).toBe("1");
    const serialized = JSON.stringify(queryArg.filters);
    expect(serialized).toContain(compactUtc(window.from));
    expect(serialized).toContain(compactUtc(window.to));

    expect(result.reset).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.cursor).toBeNull();
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]?.title).toBe("Call");
    expect(result.deletedProviderIds).toEqual([]);
  });

  it("throws CalendarConflictError on HTTP 412 when PUTting with If-Match", async () => {
    davMocks.fetchCalendarObjects.mockResolvedValue([
      { url: EVENT_HREF, etag: '"abc"', data: timedIcs },
    ]);
    davMocks.updateCalendarObject.mockResolvedValue({
      status: 412,
      ok: false,
    });

    const err = adapter().updateEvent(
      { providerCalendarId: CAL_URL },
      {
        providerEventId: EVENT_HREF,
        etag: '"abc"',
        recurrenceId: null,
      },
      eventInput,
      "all",
    );

    await expect(err).rejects.toBeInstanceOf(CalendarConflictError);
    await expect(err).rejects.toThrow("This event changed on this calendar.");

    expect(davMocks.updateCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: EVENT_HREF,
          etag: '"abc"',
        }),
      }),
    );
  });

  it("updates PARTSTAT on the matching ATTENDEE when responding", async () => {
    davMocks.fetchCalendarObjects.mockResolvedValue([
      { url: EVENT_HREF, etag: '"abc"', data: timedIcs },
    ]);
    davMocks.updateCalendarObject.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => '"def"' },
    });

    const updated = await adapter().respond(
      { providerCalendarId: CAL_URL },
      { providerEventId: EVENT_HREF },
      "accepted",
    );

    const put = davMocks.updateCalendarObject.mock.calls[0]?.[0] as {
      calendarObject: { data: string; etag?: string };
    };
    expect(put.calendarObject.data).toMatch(/PARTSTAT=ACCEPTED/i);
    expect(put.calendarObject.data).not.toMatch(/PARTSTAT=NEEDS-ACTION/i);
    expect(updated.title).toBe("Call");
  });

  it("creates ICS with provided icalUid and attendee so respond can match", async () => {
    davMocks.createCalendarObject.mockResolvedValue({
      status: 201,
      ok: true,
      headers: { get: () => '"etag1"' },
    });

    const created = await adapter().createEvent(
      { providerCalendarId: CAL_URL },
      {
        ...eventInput,
        icalUid: "invite-1@x.y",
        organizer: { email: "ada@x.y", name: "Ada" },
        attendees: [
          { email: "user@example.com", status: "needsAction", self: true },
        ],
      },
    );

    const put = davMocks.createCalendarObject.mock.calls[0]?.[0] as {
      iCalString: string;
      filename: string;
    };
    expect(put.filename).toBe("invite-1@x.y.ics");
    expect(put.iCalString).toContain("UID:invite-1@x.y");
    expect(put.iCalString).toContain("mailto:user@example.com");
    expect(put.iCalString).toMatch(/PARTSTAT=NEEDS-ACTION/i);
    expect(put.iCalString).toContain("mailto:ada@x.y");
    expect(created.icalUid).toBe("invite-1@x.y");
  });

  it("throws a generic error on HTTP 403 writes, not CalendarConflictError", async () => {
    davMocks.fetchCalendarObjects.mockResolvedValue([
      { url: EVENT_HREF, etag: '"abc"', data: timedIcs },
    ]);
    davMocks.updateCalendarObject.mockResolvedValue({
      status: 403,
      ok: false,
    });
    davMocks.deleteCalendarObject.mockResolvedValue({
      status: 403,
      ok: false,
    });

    const cal = adapter();
    await expect(
      cal.updateEvent(
        { providerCalendarId: CAL_URL },
        {
          providerEventId: EVENT_HREF,
          etag: '"abc"',
          recurrenceId: null,
        },
        eventInput,
        "all",
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof CalendarConflictError) &&
        /403/.test(err.message),
    );

    await expect(
      cal.deleteEvent(
        { providerCalendarId: CAL_URL },
        {
          providerEventId: EVENT_HREF,
          etag: '"abc"',
          recurrenceId: null,
        },
        "all",
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof CalendarConflictError) &&
        /403/.test(err.message),
    );
  });

  it("throws a generic error on HTTP 500 writes", async () => {
    davMocks.fetchCalendarObjects.mockResolvedValue([
      { url: EVENT_HREF, etag: '"abc"', data: timedIcs },
    ]);
    davMocks.updateCalendarObject.mockResolvedValue({
      status: 500,
      ok: false,
    });
    davMocks.createCalendarObject.mockResolvedValue({
      status: 500,
      ok: false,
    });

    const cal = adapter();
    await expect(
      cal.updateEvent(
        { providerCalendarId: CAL_URL },
        {
          providerEventId: EVENT_HREF,
          etag: '"abc"',
          recurrenceId: null,
        },
        eventInput,
        "all",
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof CalendarConflictError) &&
        /500/.test(err.message),
    );

    await expect(
      cal.createEvent({ providerCalendarId: CAL_URL }, eventInput),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof CalendarConflictError) &&
        /500/.test(err.message),
    );
  });

  it("retries syncCollection without a token and sets reset true on invalid sync-token", async () => {
    davMocks.syncCollection
      .mockResolvedValueOnce([{ status: 403, ok: false, statusText: "Forbidden" }])
      .mockResolvedValueOnce([
        {
          href: EVENT_HREF,
          status: 200,
          ok: true,
          props: {
            getetag: '"etag1"',
            calendarData: timedIcs,
          },
          raw: { multistatus: { syncToken: "sync-new" } },
        },
      ]);

    const result = await adapter().pull(
      { providerCalendarId: CAL_URL, syncToken: "stale" },
      null,
    );

    expect(davMocks.syncCollection).toHaveBeenCalledTimes(2);
    expect(davMocks.syncCollection.mock.calls[0]?.[0]).toMatchObject({
      url: CAL_URL,
      syncToken: "stale",
    });
    expect(davMocks.syncCollection.mock.calls[1]?.[0]).toMatchObject({
      url: CAL_URL,
      syncToken: "",
    });
    expect(davMocks.calendarQuery).not.toHaveBeenCalled();
    expect(result.reset).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.cursor).toBe("sync-new");
    expect(result.upserts[0]?.providerEventId).toBe(EVENT_HREF);
  });

  it("throws on other syncCollection HTTP errors instead of calendarQuery", async () => {
    davMocks.syncCollection.mockResolvedValue([
      { status: 500, ok: false, statusText: "Internal Server Error" },
    ]);

    await expect(
      adapter().pull({ providerCalendarId: CAL_URL, syncToken: "sync-1" }, null),
    ).rejects.toThrow(/500/);
    expect(davMocks.calendarQuery).not.toHaveBeenCalled();
  });
});
