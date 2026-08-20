import { describe, it, expect } from "vitest";
import {
  rsvpSendsItip,
  resolveRsvpCalendar,
} from "@/lib/calendar/rsvp-route";

describe("rsvpSendsItip", () => {
  it("is false for Google and Microsoft, true for CalDAV", () => {
    expect(rsvpSendsItip("GOOGLE")).toBe(false);
    expect(rsvpSendsItip("MICROSOFT")).toBe(false);
    expect(rsvpSendsItip("CALDAV")).toBe(true);
  });
});

describe("resolveRsvpCalendar", () => {
  const cals = [
    {
      id: "ro",
      isReadOnly: true,
      isPrimary: true,
      isVisible: true,
      principalEmail: "me@x.y",
    },
    {
      id: "work",
      isReadOnly: false,
      isPrimary: true,
      isVisible: true,
      principalEmail: "me@x.y",
    },
    {
      id: "other",
      isReadOnly: false,
      isPrimary: true,
      isVisible: true,
      principalEmail: "you@z.w",
    },
  ];

  it("uses explicit writable id", () => {
    expect(resolveRsvpCalendar(cals, "me@x.y", [], "other")).toBe("other");
  });

  it("rejects explicit read-only", () => {
    expect(resolveRsvpCalendar(cals, "me@x.y", [], "ro")).toBeNull();
  });

  it("picks primary writable on the matching principal", () => {
    expect(resolveRsvpCalendar(cals, "me@x.y", [])).toBe("work");
  });

  it("falls back to the first writable visible calendar", () => {
    expect(resolveRsvpCalendar(cals, "nobody@x.y", [])).toBe("work");
  });

  it("returns null when nothing is writable", () => {
    expect(
      resolveRsvpCalendar(cals.filter((c) => c.isReadOnly), "me@x.y", []),
    ).toBeNull();
  });
});
