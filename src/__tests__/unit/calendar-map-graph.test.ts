import { describe, it, expect } from "vitest";
import { mapGraphEvent } from "@/lib/calendar/providers/map-graph";

const base = {
  id: "g1",
  subject: "Recurring",
  isAllDay: false,
  start: { dateTime: "2026-08-20T14:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-08-20T15:00:00.0000000", timeZone: "UTC" },
};

describe("mapGraphEvent recurrence", () => {
  it("encodes relativeMonthly index as BYDAY ordinals", () => {
    const event = mapGraphEvent({
      ...base,
      recurrence: {
        pattern: {
          type: "relativeMonthly",
          interval: 1,
          daysOfWeek: ["thursday"],
          index: "second",
        },
        range: { type: "noEnd" },
      },
    });

    expect(event.rrule).toBe("FREQ=MONTHLY;BYDAY=2TH");
  });

  it("encodes relativeYearly last weekday with BYMONTH", () => {
    const event = mapGraphEvent({
      ...base,
      recurrence: {
        pattern: {
          type: "relativeYearly",
          daysOfWeek: ["monday"],
          index: "last",
          month: 8,
        },
        range: { type: "numbered", numberOfOccurrences: 3 },
      },
    });

    expect(event.rrule).toBe("FREQ=YEARLY;BYDAY=-1MO;BYMONTH=8;COUNT=3");
  });

  it("returns null rrule for relativeMonthly without index", () => {
    const event = mapGraphEvent({
      ...base,
      recurrence: {
        pattern: {
          type: "relativeMonthly",
          daysOfWeek: ["thursday"],
        },
      },
    });

    expect(event.rrule).toBeNull();
  });
});
