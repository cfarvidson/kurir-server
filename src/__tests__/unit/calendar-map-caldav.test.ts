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

describe("mapCalDavEvent travel time", () => {
  const appleIcs = (start: string) => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:travel-1
SUMMARY:Dentist
${start}
X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M
X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="Storgatan 1\\n111 22 Stockholm";X-TITLE=Home:
X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC
END:VEVENT
END:VCALENDAR`;

  it("reads Apple's travel time in minutes and keeps the other travel lines as Apple wrote them", () => {
    const event = mapCalDavEvent({
      data: appleIcs("DTSTART:20261009T080000Z\nDTEND:20261009T090000Z"),
    });

    expect(event.travelMinutes).toBe(90);
    expect(event.travelExtra).toEqual([
      'X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="Storgatan 1\\n111 22 Stockholm";X-TITLE=Home:',
      "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
    ]);
  });

  it("has no travel time on an all-day event or one without the lines", () => {
    const allDay = mapCalDavEvent({
      data: appleIcs(
        "DTSTART;VALUE=DATE:20261009\nDTEND;VALUE=DATE:20261010",
      ),
    });
    const plain = mapCalDavEvent({
      data: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:plain
SUMMARY:Lunch
DTSTART:20261009T110000Z
DTEND:20261009T120000Z
END:VEVENT
END:VCALENDAR`,
    });

    expect(allDay.travelMinutes).toBeNull();
    expect(allDay.travelExtra).toEqual([]);
    expect(plain.travelMinutes).toBeNull();
    expect(plain.travelExtra).toEqual([]);
  });
});
