import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseIcs, isCalendarPart } from "@/lib/calendar/ics";

function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, "../fixtures/ics", name),
    "utf8",
  );
}

describe("isCalendarPart", () => {
  it("matches text/calendar and .ics filenames", () => {
    expect(isCalendarPart("text/calendar", null)).toBe(true);
    expect(isCalendarPart("application/octet-stream", "invite.ics")).toBe(
      true,
    );
    expect(isCalendarPart("image/png", "photo.png")).toBe(false);
  });
});

describe("parseIcs", () => {
  it("parses a Google REQUEST", () => {
    const parsed = parseIcs(fixture("google-request.ics"));
    expect(parsed?.uid).toBe("g-uid-1@google.com");
    expect(parsed?.method).toBe("REQUEST");
    expect(parsed?.title).toBe("Design review");
    expect(parsed?.location).toBe("Room 4");
    expect(parsed?.organizerEmail).toBe("ada@x.y");
    expect(parsed?.isAllDay).toBe(false);
  });

  it("parses Outlook TZID starts", () => {
    const parsed = parseIcs(fixture("outlook-request.ics"));
    expect(parsed?.method).toBe("REQUEST");
    expect(parsed?.startAt).toBeInstanceOf(Date);
  });

  it("marks VALUE=DATE as all-day with exclusive end", () => {
    const parsed = parseIcs(fixture("all-day.ics"));
    expect(parsed?.isAllDay).toBe(true);
    expect(parsed?.startAt?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(parsed?.endAt?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("parses CANCEL", () => {
    expect(parseIcs(fixture("cancel.ics"))?.method).toBe("CANCEL");
  });

  it("keeps RECURRENCE-ID on an instance invite", () => {
    const parsed = parseIcs(fixture("recurring-instance.ics"));
    expect(parsed?.recurrenceId).toBeInstanceOf(Date);
  });

  it("returns null for garbage", () => {
    expect(parseIcs(fixture("garbage.ics"))).toBeNull();
  });
});
