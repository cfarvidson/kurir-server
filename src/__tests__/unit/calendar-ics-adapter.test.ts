import { describe, it, expect, vi, beforeEach } from "vitest";

const { dnsMocks, pinnedMocks } = vi.hoisted(() => ({
  dnsMocks: { lookup: vi.fn() },
  pinnedMocks: { fetchPinned: vi.fn() },
}));

vi.mock("node:dns/promises", () => ({
  lookup: dnsMocks.lookup,
}));

vi.mock("@/lib/calendar/ics-pinned", () => ({
  fetchPinned: pinnedMocks.fetchPinned,
}));

import { createIcsAdapter } from "@/lib/calendar/providers/ics";

const FEED_URL = "https://school.example/term.ics";

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test
X-WR-CALNAME:School term
BEGIN:VEVENT
UID:all-day-1
DTSTART;VALUE=DATE:20260901
DTEND;VALUE=DATE:20260902
SUMMARY:Inset day
END:VEVENT
BEGIN:VEVENT
UID:kickoff-1
DTSTART;TZID=Europe/Stockholm:20260902T190000
DTEND;TZID=Europe/Stockholm:20260902T210000
SUMMARY:Kick-off
RRULE:FREQ=WEEKLY;BYDAY=WE
EXDATE;TZID=Europe/Stockholm:20260909T190000
END:VEVENT
BEGIN:VEVENT
SUMMARY:No uid or start
END:VEVENT
END:VCALENDAR`;

const FEED_WITHOUT_INSET = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test
X-WR-CALNAME:School term
BEGIN:VEVENT
UID:kickoff-1
DTSTART;TZID=Europe/Stockholm:20260902T190000
DTEND;TZID=Europe/Stockholm:20260902T210000
SUMMARY:Kick-off
END:VEVENT
END:VCALENDAR`;

function jsonResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/calendar", ...headers },
  });
}

describe("createIcsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dnsMocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("lists one read-only calendar named from X-WR-CALNAME", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, FEED));
    const calendars = await createIcsAdapter({ url: FEED_URL }).listCalendars();
    expect(calendars).toEqual([
      {
        providerCalendarId: FEED_URL,
        name: "School term",
        color: null,
        isPrimary: true,
        isReadOnly: true,
        timezone: null,
      },
    ]);
  });

  it("pulls every mappable VEVENT and skips a bad one", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, FEED));
    const result = await createIcsAdapter({ url: FEED_URL }).pull(
      { providerCalendarId: FEED_URL, syncToken: null },
      null,
    );
    expect(result.reset).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.upserts.map((e) => e.icalUid).sort()).toEqual([
      "all-day-1",
      "kickoff-1",
    ]);
    const inset = result.upserts.find((e) => e.icalUid === "all-day-1")!;
    expect(inset.isAllDay).toBe(true);
    expect(inset.startAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    const kick = result.upserts.find((e) => e.icalUid === "kickoff-1")!;
    expect(kick.timezone).toBe("Europe/Stockholm");
    expect(kick.rrule).toMatch(/FREQ=WEEKLY/);
    expect(kick.exdate).toBeTruthy();
  });

  it("reports a removed UID as a reset so the replica drops it", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(jsonResponse(200, FEED_WITHOUT_INSET));
    const result = await createIcsAdapter({ url: FEED_URL }).pull(
      { providerCalendarId: FEED_URL, syncToken: '"v1"' },
      null,
    );
    expect(result.reset).toBe(true);
    expect(result.upserts.map((e) => e.icalUid)).toEqual(["kickoff-1"]);
  });

  it("is a no-op when the ETag is unchanged", async () => {
    pinnedMocks.fetchPinned.mockResolvedValue(new Response(null, { status: 304 }));
    const result = await createIcsAdapter({ url: FEED_URL }).pull(
      { providerCalendarId: FEED_URL, syncToken: '"v1"' },
      null,
    );
    expect(result).toEqual({
      upserts: [],
      deletedProviderIds: [],
      cursor: '"v1"',
      reset: false,
      complete: true,
    });
    const [url, , , headers] = pinnedMocks.fetchPinned.mock.calls[0];
    expect((url as URL).toString()).toBe(FEED_URL);
    expect((headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
  });

  it("refuses writes", async () => {
    const adapter = createIcsAdapter({ url: FEED_URL });
    const cal = { providerCalendarId: FEED_URL };
    const event = { providerEventId: "x", etag: null, recurrenceId: null };
    const input = {
      title: "Nope",
      description: null,
      location: null,
      startAt: new Date(),
      endAt: new Date(),
      isAllDay: false,
      timezone: null,
      rrule: null,
    };
    await expect(adapter.createEvent(cal, input)).rejects.toThrow(/read-only/i);
    await expect(
      adapter.updateEvent(cal, event, input, "all"),
    ).rejects.toThrow(/read-only/i);
    await expect(adapter.deleteEvent(cal, event, "all")).rejects.toThrow(
      /read-only/i,
    );
    await expect(adapter.moveEvent(cal, cal, event)).rejects.toThrow(
      /read-only/i,
    );
    await expect(adapter.respond(cal, event, "accepted")).rejects.toThrow(
      /read-only/i,
    );
  });
});
