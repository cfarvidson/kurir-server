import { describe, it, expect } from "vitest";
import { canonicalizeIcsUrl } from "@/lib/calendar/ics-account";

describe("canonicalizeIcsUrl", () => {
  it("rewrites webcal, webcals and http to https and strips trailing slashes", () => {
    expect(canonicalizeIcsUrl("webcal://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("webcals://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("http://example.com/holidays.ics")).toBe(
      "https://example.com/holidays.ics",
    );
    expect(canonicalizeIcsUrl("  https://example.com/holidays.ics/  ")).toBe(
      "https://example.com/holidays.ics",
    );
  });

  it("keeps query tokens so a Google secret address still works", () => {
    expect(
      canonicalizeIcsUrl(
        "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-token/basic.ics",
      ),
    ).toBe(
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-token/basic.ics",
    );
  });

  it("rejects userinfo so this path stays the no-auth door", () => {
    expect(() =>
      canonicalizeIcsUrl("https://user:pass@example.com/cal.ics"),
    ).toThrow(/no login/i);
  });

  it("rejects non-http schemes", () => {
    expect(() => canonicalizeIcsUrl("file:///tmp/cal.ics")).toThrow(
      /not a calendar url/i,
    );
    expect(() => canonicalizeIcsUrl("javascript:alert(1)")).toThrow(
      /not a calendar url/i,
    );
  });
});
