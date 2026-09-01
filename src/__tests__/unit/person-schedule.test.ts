import { describe, it, expect } from "vitest";
import {
  SCHEDULE_PACKED_BODY,
  SCHEDULE_SUBJECT,
  nextWeekdays,
  scheduleDraft,
  slotLines,
} from "@/lib/mail/person-schedule";
import { isWeekend } from "@/lib/calendar/view-time";

const tuesday = new Date("2026-09-08T10:00:00.000Z");

describe("nextWeekdays", () => {
  it("skips the weekend and keeps seven", () => {
    const days = nextWeekdays(tuesday, "UTC");
    expect(days.map((d) => d.day)).toEqual([8, 9, 10, 11, 14, 15, 16]);
    expect(days.every((d) => !isWeekend(d))).toBe(true);
  });

  it("starts on Monday when now is Saturday", () => {
    const saturday = new Date(tuesday.getTime() + 4 * 86_400_000);
    const days = nextWeekdays(saturday, "UTC");
    expect(days.map((d) => d.day)).toEqual([14, 15, 16, 17, 18, 21, 22]);
  });
});

describe("scheduleDraft", () => {
  it("lists weekday slots inside visible hours", () => {
    const draft = scheduleDraft("ada@x.y", [], tuesday, "UTC");
    expect(draft.to).toBe("ada@x.y");
    expect(draft.subject).toBe(SCHEDULE_SUBJECT);
    expect(draft.body.startsWith("Are you free any of these times?")).toBe(true);
    expect(draft.body).toContain("Tue 8 Sep, 10:00-21:00");
    expect(draft.body).toContain("Wed 9 Sep, 07:00-21:00");
    expect(draft.body).not.toContain("Sat");
    expect(draft.body).not.toContain("Sun");
  });

  it("skips holes shorter than thirty minutes", () => {
    const busy = {
      startAt: tuesday,
      endAt: new Date(tuesday.getTime() + (10 * 3600 + 50 * 60) * 1000),
      isAllDay: false,
      isCancelled: false,
      transparency: "busy" as const,
    };
    const tuesdayLines = slotLines([busy], tuesday, "UTC").filter((line) =>
      line.startsWith("Tue 8 Sep"),
    );
    expect(tuesdayLines).toEqual([]);
  });

  it("still returns a body when the week is packed", () => {
    const busy = {
      startAt: new Date(0),
      endAt: new Date(4_000_000_000_000),
      isAllDay: false,
      isCancelled: false,
      transparency: "busy" as const,
    };
    const draft = scheduleDraft("ada@x.y", [busy], tuesday, "UTC");
    expect(draft.body).toBe(SCHEDULE_PACKED_BODY);
    expect(draft.subject).toBe(SCHEDULE_SUBJECT);
  });
});
