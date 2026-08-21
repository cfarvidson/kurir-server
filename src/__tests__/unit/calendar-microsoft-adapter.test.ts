import { describe, it, expect, vi, beforeEach } from "vitest";

const { graphMocks } = vi.hoisted(() => {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const header = vi.fn();
  const api = vi.fn();
  const init = vi.fn();
  const request = {
    get,
    post,
    patch,
    delete: del,
    header,
  };
  header.mockReturnValue(request);
  api.mockReturnValue(request);
  init.mockReturnValue({ api });
  return {
    graphMocks: { get, post, patch, delete: del, header, api, init, request },
  };
});

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: graphMocks.init,
  },
}));

import { createMicrosoftAdapter } from "@/lib/calendar/providers/microsoft";



const timedEvent = {
  id: "e1",
  subject: "Call",
  isCancelled: false,
  start: { dateTime: "2026-08-20T14:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-08-20T15:00:00.0000000", timeZone: "UTC" },
};

function apiPaths(): string[] {
  return graphMocks.api.mock.calls.map((call) => String(call[0]));
}

describe("createMicrosoftAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graphMocks.header.mockReturnValue(graphMocks.request);
    graphMocks.api.mockReturnValue(graphMocks.request);
    graphMocks.init.mockReturnValue({ api: graphMocks.api });
  });

  it("lists calendars from GET /me/calendars", async () => {
    graphMocks.get.mockResolvedValue({
      value: [
        {
          id: "cal1",
          name: "Personal",
          hexColor: "#ff0000",
          isDefaultCalendar: true,
          canEdit: true,
        },
        {
          id: "holidays",
          name: "Holidays",
          canEdit: false,
        },
      ],
    });

    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });
    const calendars = await adapter.listCalendars();

    expect(graphMocks.init).toHaveBeenCalled();
    const cfg = graphMocks.init.mock.calls[0]?.[0] as {
      authProvider: (done: (err: unknown, token: string | null) => void) => void;
    };
    const done = vi.fn();
    cfg.authProvider(done);
    expect(done).toHaveBeenCalledWith(null, "tok-1");

    expect(graphMocks.api).toHaveBeenCalledWith("/me/calendars");
    expect(calendars).toEqual([
      {
        providerCalendarId: "cal1",
        name: "Personal",
        color: "#ff0000",
        isPrimary: true,
        isReadOnly: false,
        timezone: null,
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

  it("lists /events masters and does not use calendarView or events/delta", async () => {
    graphMocks.get.mockResolvedValue({
      value: [timedEvent, { id: "e2", "@removed": { reason: "deleted" } }],
    });

    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });
    const result = await adapter.pull(
      { providerCalendarId: "cal1", syncToken: "ignored-delta" },
      null,
    );

    expect(graphMocks.api).toHaveBeenCalledWith("/me/calendars/cal1/events");
    expect(apiPaths().some((path) => path.includes("calendarView"))).toBe(
      false,
    );
    expect(apiPaths().some((path) => path.includes("/events/delta"))).toBe(
      false,
    );
    expect(graphMocks.header).toHaveBeenCalledWith(
      "Prefer",
      'outlook.timezone="UTC"',
    );

    expect(result.reset).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]?.providerEventId).toBe("e1");
    expect(result.upserts[0]?.title).toBe("Call");
    expect(result.deletedProviderIds).toEqual(["e2"]);
  });

  it("creates an event via POST /me/calendars/{id}/events", async () => {
    graphMocks.post.mockResolvedValue({
      id: "new1",
      subject: "Lunch",
      start: { dateTime: "2026-08-20T12:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T13:00:00.0000000", timeZone: "UTC" },
    });

    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });
    const created = await adapter.createEvent(
      { providerCalendarId: "cal1" },
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

    expect(graphMocks.api).toHaveBeenCalledWith("/me/calendars/cal1/events");
    expect(graphMocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Lunch",
        start: expect.objectContaining({
          dateTime: expect.stringContaining("2026-08-20T12:00:00"),
        }),
        end: expect.objectContaining({
          dateTime: expect.stringContaining("2026-08-20T13:00:00"),
        }),
      }),
    );
    expect(created.providerEventId).toBe("new1");
    expect(created.title).toBe("Lunch");
    expect(created.startAt.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("posts attendees from EventInput so the user can respond", async () => {
    graphMocks.post.mockResolvedValue({
      id: "new1",
      subject: "Lunch",
      start: { dateTime: "2026-08-20T12:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T13:00:00.0000000", timeZone: "UTC" },
    });

    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });
    await adapter.createEvent(
      { providerCalendarId: "cal1" },
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

    expect(graphMocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: [
          expect.objectContaining({
            emailAddress: expect.objectContaining({ address: "me@x.y" }),
            status: expect.objectContaining({ response: "notResponded" }),
          }),
        ],
      }),
    );
  });

  it("patches thisAndFollowing and all with the master etag, not the instance etag", async () => {
    const master = {
      id: "series1",
      "@odata.etag": "etag-master",
      changeKey: "ck-master",
      subject: "Standup",
      type: "seriesMaster",
      start: { dateTime: "2026-08-13T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-13T15:00:00.0000000", timeZone: "UTC" },
      recurrence: {
        pattern: { type: "weekly", interval: 1, daysOfWeek: ["thursday"] },
        range: { type: "noEnd", startDate: "2026-08-13" },
      },
    };
    const occurrence = {
      id: "occ1",
      "@odata.etag": "etag-instance",
      changeKey: "ck-instance",
      subject: "Standup",
      type: "occurrence",
      seriesMasterId: "series1",
      originalStart: "2026-08-20T14:00:00.0000000",
      start: { dateTime: "2026-08-20T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T15:00:00.0000000", timeZone: "UTC" },
    };
    const instance = {
      providerEventId: "occ1",
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
    const calendar = { providerCalendarId: "cal1" };
    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });

    graphMocks.get.mockImplementation(async () => {
      const path = String(graphMocks.api.mock.calls.at(-1)?.[0] ?? "");
      if (path.includes("occ1")) return occurrence;
      if (path.includes("series1")) return master;
      return master;
    });
    graphMocks.patch.mockResolvedValue({ ...master, subject: "Call" });
    graphMocks.post.mockResolvedValue({
      id: "series2",
      subject: "Call",
      start: { dateTime: "2026-08-20T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T15:00:00.0000000", timeZone: "UTC" },
      recurrence: {
        pattern: { type: "weekly", interval: 1 },
        range: { type: "noEnd", startDate: "2026-08-20" },
      },
    });

    await adapter.updateEvent(calendar, instance, input, "thisAndFollowing");

    expect(apiPaths().some((path) => path.includes("series1"))).toBe(true);
    const ifMatchAfterSplit = graphMocks.header.mock.calls
      .filter((call) => call[0] === "If-Match")
      .map((call) => call[1]);
    expect(ifMatchAfterSplit).toContain("etag-master");
    expect(ifMatchAfterSplit).not.toContain("etag-instance");

    graphMocks.header.mockClear();
    graphMocks.api.mockClear();
    graphMocks.patch.mockClear();
    graphMocks.patch.mockResolvedValue({ ...master, subject: "Call" });

    await adapter.updateEvent(calendar, instance, input, "all");

    expect(apiPaths().some((path) => path.includes("series1"))).toBe(true);
    expect(graphMocks.patch).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Call" }),
    );
    const ifMatchAfterAll = graphMocks.header.mock.calls
      .filter((call) => call[0] === "If-Match")
      .map((call) => call[1]);
    expect(ifMatchAfterAll).toContain("etag-master");
    expect(ifMatchAfterAll).not.toContain("etag-instance");
  });

  it("resolves this via instances around recurrenceId instead of patching the master", async () => {
    const master = {
      id: "series1",
      "@odata.etag": "etag-master",
      subject: "Standup",
      type: "seriesMaster",
      start: { dateTime: "2026-08-13T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-13T15:00:00.0000000", timeZone: "UTC" },
      recurrence: {
        pattern: { type: "weekly", interval: 1, daysOfWeek: ["thursday"] },
        range: { type: "noEnd", startDate: "2026-08-13" },
      },
    };
    const occurrence = {
      id: "occ1",
      "@odata.etag": "etag-occurrence",
      subject: "Standup",
      type: "occurrence",
      seriesMasterId: "series1",
      originalStart: "2026-08-20T14:00:00.0000000",
      start: { dateTime: "2026-08-20T14:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T15:00:00.0000000", timeZone: "UTC" },
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
    const calendar = { providerCalendarId: "cal1" };
    const replica = {
      providerEventId: "series1",
      etag: "etag-master",
      recurrenceId: new Date("2026-08-20T14:00:00.000Z"),
    };
    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });

    graphMocks.get.mockImplementation(async () => {
      const path = String(graphMocks.api.mock.calls.at(-1)?.[0] ?? "");
      if (path.includes("/instances")) return { value: [occurrence] };
      if (path.includes("occ1")) return occurrence;
      if (path.includes("series1")) return master;
      return master;
    });

    const patchedPaths: string[] = [];
    graphMocks.patch.mockImplementation(async () => {
      patchedPaths.push(String(graphMocks.api.mock.calls.at(-1)?.[0] ?? ""));
      return { ...occurrence, subject: "Call" };
    });

    await adapter.updateEvent(calendar, replica, input, "this");

    const instancesPath = apiPaths().find((path) => path.includes("/instances"));
    expect(instancesPath).toBeDefined();
    expect(instancesPath).toContain("/events/series1/instances");
    expect(instancesPath).toContain("startDateTime=");
    expect(instancesPath).not.toContain("calendarView");
    expect(patchedPaths.some((path) => path.includes("/events/occ1"))).toBe(
      true,
    );
    expect(
      patchedPaths.some(
        (path) => path.includes("/events/series1") && !path.includes("occ1"),
      ),
    ).toBe(false);
    const ifMatch = graphMocks.header.mock.calls
      .filter((call) => call[0] === "If-Match")
      .map((call) => call[1]);
    expect(ifMatch).toContain("etag-occurrence");
    expect(ifMatch).not.toContain("etag-master");

    const deletedPaths: string[] = [];
    graphMocks.delete.mockImplementation(async () => {
      deletedPaths.push(String(graphMocks.api.mock.calls.at(-1)?.[0] ?? ""));
    });

    await adapter.deleteEvent(calendar, replica, "this");

    expect(deletedPaths.some((path) => path.includes("/events/occ1"))).toBe(
      true,
    );
    expect(
      deletedPaths.some(
        (path) => path.includes("/events/series1") && !path.includes("occ1"),
      ),
    ).toBe(false);
  });

  it("posts timed events as wall clock in the event timezone", async () => {
    graphMocks.post.mockResolvedValue({
      id: "new1",
      subject: "Lunch",
      start: { dateTime: "2026-08-20T08:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-20T09:00:00.0000000", timeZone: "UTC" },
    });

    const adapter = createMicrosoftAdapter({ accessToken: "tok-1" });
    await adapter.createEvent(
      { providerCalendarId: "cal1" },
      {
        title: "Lunch",
        description: null,
        location: null,
        startAt: new Date("2026-08-20T08:00:00.000Z"),
        endAt: new Date("2026-08-20T09:00:00.000Z"),
        isAllDay: false,
        timezone: "Europe/Stockholm",
        rrule: null,
      },
    );

    expect(graphMocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Lunch",
        start: {
          dateTime: expect.stringContaining("2026-08-20T10:00:00"),
          timeZone: "Europe/Stockholm",
        },
        end: {
          dateTime: expect.stringContaining("2026-08-20T11:00:00"),
          timeZone: "Europe/Stockholm",
        },
      }),
    );
    expect(graphMocks.post.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({
        start: expect.objectContaining({
          dateTime: expect.stringContaining("2026-08-20T08:00:00"),
        }),
      }),
    );
  });
});
