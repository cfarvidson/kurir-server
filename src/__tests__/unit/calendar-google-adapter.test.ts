import { describe, it, expect, vi, beforeEach } from "vitest";

const { googleMocks } = vi.hoisted(() => {
  const setCredentials = vi.fn();
  const calendarListList = vi.fn();
  const eventsList = vi.fn();
  const eventsInsert = vi.fn();
  const eventsPatch = vi.fn();
  const eventsDelete = vi.fn();
  const eventsGet = vi.fn();
  class MockOAuth2 {
    setCredentials = setCredentials;
  }
  const calendar = vi.fn(() => ({
    calendarList: { list: calendarListList },
    events: {
      list: eventsList,
      insert: eventsInsert,
      patch: eventsPatch,
      delete: eventsDelete,
      get: eventsGet,
    },
  }));
  return {
    googleMocks: {
      setCredentials,
      calendarListList,
      eventsList,
      eventsInsert,
      eventsPatch,
      eventsDelete,
      eventsGet,
      calendar,
      MockOAuth2,
    },
  };
});

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: googleMocks.MockOAuth2 },
    calendar: googleMocks.calendar,
  },
}));

import { createGoogleAdapter } from "@/lib/calendar/providers/google";

function goneError(): Error & { code: number; response: { status: number } } {
  const err = new Error("Sync token is no longer valid") as Error & {
    code: number;
    response: { status: number };
  };
  err.code = 410;
  err.response = { status: 410 };
  return err;
}

const timedEvent = {
  id: "e1",
  summary: "Call",
  status: "confirmed",
  start: { dateTime: "2026-08-20T14:00:00Z" },
  end: { dateTime: "2026-08-20T15:00:00Z" },
};

describe("createGoogleAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists calendars from calendarList.list", async () => {
    googleMocks.calendarListList.mockResolvedValue({
      data: {
        items: [
          {
            id: "primary",
            summary: "Personal",
            backgroundColor: "#ff0000",
            primary: true,
            accessRole: "owner",
            timeZone: "UTC",
          },
          {
            id: "holidays",
            summary: "Holidays",
            accessRole: "reader",
          },
        ],
      },
    });

    const adapter = createGoogleAdapter({ accessToken: "tok-1" });
    const calendars = await adapter.listCalendars();

    expect(googleMocks.setCredentials).toHaveBeenCalledWith({
      access_token: "tok-1",
    });
    expect(googleMocks.calendar).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v3" }),
    );
    expect(googleMocks.calendarListList).toHaveBeenCalled();
    expect(calendars).toEqual([
      {
        providerCalendarId: "primary",
        name: "Personal",
        color: "#ff0000",
        isPrimary: true,
        isReadOnly: false,
        timezone: "UTC",
      },
      {
        providerCalendarId: "holidays",
        name: "Holidays",
        color: null,
        isPrimary: false,
        isReadOnly: true,
        timezone: null,
      },
    ]);
  });

  it("pulls incrementally with syncToken and no timeMin", async () => {
    googleMocks.eventsList.mockResolvedValue({
      data: {
        items: [
          timedEvent,
          { id: "e2", status: "cancelled" },
        ],
        nextSyncToken: "sync-2",
      },
    });

    const adapter = createGoogleAdapter({ accessToken: "tok-1" });
    const result = await adapter.pull(
      { providerCalendarId: "primary", syncToken: "sync-1" },
      null,
    );

    expect(googleMocks.eventsList).toHaveBeenCalledTimes(1);
    const params = googleMocks.eventsList.mock.calls[0][0];
    expect(params).toMatchObject({
      calendarId: "primary",
      syncToken: "sync-1",
      singleEvents: false,
    });
    expect(params.timeMin).toBeUndefined();

    expect(result.reset).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.cursor).toBe("sync-2");
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]?.providerEventId).toBe("e1");
    expect(result.upserts[0]?.title).toBe("Call");
    expect(result.deletedProviderIds).toEqual(["e2"]);
  });

  it("resets with a full list on Google 410", async () => {
    googleMocks.eventsList
      .mockRejectedValueOnce(goneError())
      .mockResolvedValueOnce({
        data: {
          items: [timedEvent],
          nextSyncToken: "sync-new",
        },
      });

    const adapter = createGoogleAdapter({ accessToken: "tok-1" });
    const result = await adapter.pull(
      { providerCalendarId: "primary", syncToken: "stale" },
      null,
    );

    expect(googleMocks.eventsList).toHaveBeenCalledTimes(2);
    expect(googleMocks.eventsList.mock.calls[0][0]).toMatchObject({
      calendarId: "primary",
      syncToken: "stale",
      singleEvents: false,
    });
    const retry = googleMocks.eventsList.mock.calls[1][0];
    expect(retry.syncToken).toBeUndefined();
    expect(retry).toMatchObject({
      calendarId: "primary",
      singleEvents: false,
    });

    expect(result.reset).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.cursor).toBe("sync-new");
    expect(result.upserts[0]?.providerEventId).toBe("e1");
  });

  it("creates an event via events.insert", async () => {
    googleMocks.eventsInsert.mockResolvedValue({
      data: {
        id: "new1",
        summary: "Lunch",
        status: "confirmed",
        start: { dateTime: "2026-08-20T12:00:00Z" },
        end: { dateTime: "2026-08-20T13:00:00Z" },
      },
    });

    const adapter = createGoogleAdapter({ accessToken: "tok-1" });
    const created = await adapter.createEvent(
      { providerCalendarId: "primary" },
      {
        title: "Lunch",
        description: null,
        location: null,
        startAt: new Date("2026-08-20T12:00:00.000Z"),
        endAt: new Date("2026-08-20T13:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: null,
      },
    );

    expect(googleMocks.eventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          summary: "Lunch",
          start: expect.objectContaining({
            dateTime: "2026-08-20T12:00:00.000Z",
          }),
          end: expect.objectContaining({
            dateTime: "2026-08-20T13:00:00.000Z",
          }),
        }),
      }),
    );
    expect(created.providerEventId).toBe("new1");
    expect(created.title).toBe("Lunch");
    expect(created.startAt.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("inserts iCalUID and attendees from EventInput", async () => {
    googleMocks.eventsInsert.mockResolvedValue({
      data: {
        id: "new1",
        iCalUID: "invite-uid",
        summary: "Lunch",
        status: "confirmed",
        start: { dateTime: "2026-08-20T12:00:00Z" },
        end: { dateTime: "2026-08-20T13:00:00Z" },
        attendees: [
          { email: "me@x.y", responseStatus: "needsAction", self: true },
        ],
      },
    });

    const adapter = createGoogleAdapter({ accessToken: "tok-1" });
    await adapter.createEvent(
      { providerCalendarId: "primary" },
      {
        title: "Lunch",
        description: null,
        location: null,
        startAt: new Date("2026-08-20T12:00:00.000Z"),
        endAt: new Date("2026-08-20T13:00:00.000Z"),
        isAllDay: false,
        timezone: "UTC",
        rrule: null,
        icalUid: "invite-uid",
        attendees: [{ email: "me@x.y", self: true, status: "needsAction" }],
      },
    );

    expect(googleMocks.eventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          iCalUID: "invite-uid",
          attendees: [
            expect.objectContaining({
              email: "me@x.y",
              responseStatus: "needsAction",
              self: true,
            }),
          ],
        }),
      }),
    );
  });

  it("patches thisAndFollowing and all with the master etag, not the instance etag", async () => {
    const master = {
      id: "series1",
      etag: "etag-master",
      summary: "Standup",
      status: "confirmed",
      start: { dateTime: "2026-08-13T14:00:00Z" },
      end: { dateTime: "2026-08-13T15:00:00Z" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    };
    const instance = {
      providerEventId: "series1_20260820T140000Z",
      etag: "etag-instance",
      recurrenceId: new Date("2026-08-20T14:00:00.000Z"),
    };
    const input = {
      title: "Call",
      description: null,
      location: null,
      startAt: new Date("2026-08-20T14:00:00.000Z"),
      endAt: new Date("2026-08-20T15:00:00.000Z"),
      isAllDay: false,
      timezone: "UTC",
      rrule: "FREQ=WEEKLY",
    };
    const calendar = { providerCalendarId: "primary" };
    const adapter = createGoogleAdapter({ accessToken: "tok-1" });

    googleMocks.eventsGet.mockResolvedValue({ data: master });
    googleMocks.eventsPatch.mockResolvedValue({
      data: { ...master, summary: "Call" },
    });
    googleMocks.eventsInsert.mockResolvedValue({
      data: {
        id: "series2",
        summary: "Call",
        status: "confirmed",
        start: { dateTime: "2026-08-20T14:00:00Z" },
        end: { dateTime: "2026-08-20T15:00:00Z" },
        recurrence: ["RRULE:FREQ=WEEKLY"],
      },
    });

    await adapter.updateEvent(calendar, instance, input, "thisAndFollowing");

    expect(googleMocks.eventsGet).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "series1",
    });
    expect(googleMocks.eventsPatch.mock.calls[0]?.[1]).toEqual({
      headers: { "If-Match": "etag-master" },
    });

    googleMocks.eventsGet.mockClear();
    googleMocks.eventsPatch.mockClear();
    googleMocks.eventsGet.mockResolvedValue({ data: master });
    googleMocks.eventsPatch.mockResolvedValue({
      data: { ...master, summary: "Call" },
    });

    await adapter.updateEvent(calendar, instance, input, "all");

    expect(googleMocks.eventsGet).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "series1",
    });
    expect(googleMocks.eventsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        eventId: "series1",
      }),
      { headers: { "If-Match": "etag-master" } },
    );
  });
});
