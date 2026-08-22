import { describe, it, expect } from "vitest";
import { mapGoogleEvent } from "@/lib/calendar/providers/map-google";

describe("mapGoogleEvent", () => {
  it("maps all-day date fields with exclusive end", () => {
    const event = mapGoogleEvent({
      id: "e1",
      iCalUID: "u1",
      summary: "Off",
      status: "confirmed",
      start: { date: "2026-08-20" },
      end: { date: "2026-08-21" },
    });

    expect(event.providerEventId).toBe("e1");
    expect(event.icalUid).toBe("u1");
    expect(event.title).toBe("Off");
    expect(event.isAllDay).toBe(true);
    expect(event.status).toBe("confirmed");
    expect(event.startAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(event.endAt.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("maps timed dateTime fields as not all-day", () => {
    const event = mapGoogleEvent({
      id: "e2",
      iCalUID: "u2",
      summary: "Call",
      status: "confirmed",
      start: { dateTime: "2026-08-20T14:00:00Z" },
      end: { dateTime: "2026-08-20T15:00:00Z" },
    });

    expect(event.isAllDay).toBe(false);
    expect(event.startAt.toISOString()).toBe("2026-08-20T14:00:00.000Z");
    expect(event.endAt.toISOString()).toBe("2026-08-20T15:00:00.000Z");
  });

  it('maps transparency "transparent" to free', () => {
    const event = mapGoogleEvent({
      id: "e3",
      summary: "Focus",
      status: "confirmed",
      transparency: "transparent",
      start: { dateTime: "2026-08-20T10:00:00Z" },
      end: { dateTime: "2026-08-20T11:00:00Z" },
    });

    expect(event.transparency).toBe("free");
  });

  it("maps recurringEventId + originalStartTime to exception fields", () => {
    const event = mapGoogleEvent({
      id: "e1_20260820T140000Z",
      iCalUID: "u1",
      summary: "Standup (moved)",
      status: "confirmed",
      recurringEventId: "e1",
      originalStartTime: { dateTime: "2026-08-20T14:00:00Z" },
      start: { dateTime: "2026-08-20T15:00:00Z" },
      end: { dateTime: "2026-08-20T15:30:00Z" },
    });

    expect(event.masterProviderEventId).toBe("e1");
    expect(event.recurrenceId?.toISOString()).toBe("2026-08-20T14:00:00.000Z");
  });

  it('maps status "cancelled" to cancelled', () => {
    const event = mapGoogleEvent({
      id: "e4",
      summary: "Gone",
      status: "cancelled",
      start: { dateTime: "2026-08-20T09:00:00Z" },
      end: { dateTime: "2026-08-20T10:00:00Z" },
    });

    expect(event.status).toBe("cancelled");
  });
});
