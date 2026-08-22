import { describe, it, expect } from "vitest";
import { mapCalDavEvent } from "@/lib/calendar/providers/map-caldav";

describe("mapCalDavEvent rdate/exdate", () => {
  it("formats EXDATE and RDATE as compact UTC stamps for expand.ts", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:caldav-ex
SUMMARY:Series
DTSTART:20260820T140000Z
DTEND:20260820T150000Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20260821T140000Z
EXDATE;TZID=UTC:20260822T140000
RDATE:20260825T140000Z
END:VEVENT
END:VCALENDAR`;

    const event = mapCalDavEvent({
      href: "/c/caldav-ex.ics",
      etag: '"1"',
      data: ics,
    });

    expect(event.exdate).toBe("20260821T140000Z,20260822T140000Z");
    expect(event.rdate).toBe("20260825T140000Z");
  });

  it("formats VALUE=DATE EXDATE and PERIOD RDATE as compact stamps", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:caldav-date
SUMMARY:All-day series
DTSTART;VALUE=DATE:20260820
DTEND;VALUE=DATE:20260821
RRULE:FREQ=DAILY;COUNT=5
EXDATE;VALUE=DATE:20260821,20260822
RDATE;VALUE=PERIOD:20260825T140000Z/20260825T150000Z
END:VEVENT
END:VCALENDAR`;

    const event = mapCalDavEvent({ data: ics });

    expect(event.exdate).toBe("20260821T000000Z,20260822T000000Z");
    expect(event.rdate).toBe("20260825T140000Z");
  });
});
