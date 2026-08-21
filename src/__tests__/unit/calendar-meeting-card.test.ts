import { describe, it, expect } from "vitest";
import {
  meetingCardState,
  meetingDayHref,
  meetingOrganizerLabel,
  meetingResponseFromAttendees,
  meetingWhenLabel,
} from "@/lib/calendar/meeting-card";

describe("meetingCardState", () => {
  it("shows RSVP buttons for REQUEST on a writable calendar", () => {
    expect(meetingCardState("REQUEST", true, null)).toEqual({
      showButtons: true,
      cancelled: false,
      disabledReason: null,
    });
  });

  it("keeps buttons when the user already responded", () => {
    expect(meetingCardState("REQUEST", true, "accepted")).toEqual({
      showButtons: true,
      cancelled: false,
      disabledReason: null,
    });
  });

  it("marks CANCEL as cancelled with no buttons", () => {
    expect(meetingCardState("CANCEL", true, null)).toEqual({
      showButtons: false,
      cancelled: true,
      disabledReason: null,
    });
    expect(meetingCardState("CANCEL", false, "accepted")).toEqual({
      showButtons: false,
      cancelled: true,
      disabledReason: null,
    });
  });

  it("asks to connect a calendar when REQUEST has no writable calendar", () => {
    expect(meetingCardState("REQUEST", false, null)).toEqual({
      showButtons: false,
      cancelled: false,
      disabledReason: "Connect a calendar to reply.",
    });
  });

  it("hides buttons for non-REQUEST methods that are not CANCEL", () => {
    expect(meetingCardState("REPLY", true, null)).toEqual({
      showButtons: false,
      cancelled: false,
      disabledReason: null,
    });
    expect(meetingCardState("PUBLISH", false, null)).toEqual({
      showButtons: false,
      cancelled: false,
      disabledReason: null,
    });
    expect(meetingCardState("COUNTER", true, "tentative")).toEqual({
      showButtons: false,
      cancelled: false,
      disabledReason: null,
    });
  });
});

describe("meetingDayHref", () => {
  it("links timed events to the civil day in the user timezone", () => {
    expect(
      meetingDayHref("2026-08-20T22:30:00.000Z", false, "America/New_York"),
    ).toBe("/calendar/day?date=2026-08-20");
  });

  it("does not zone-shift all-day UTC midnights", () => {
    expect(
      meetingDayHref("2026-08-20T00:00:00.000Z", true, "America/New_York"),
    ).toBe("/calendar/day?date=2026-08-20");
  });

  it("returns null without a start", () => {
    expect(meetingDayHref(null, false, "UTC")).toBeNull();
  });
});

describe("meetingOrganizerLabel", () => {
  it("prefers the name and falls back to email", () => {
    expect(meetingOrganizerLabel("Ada", "ada@x.y")).toBe("Ada");
    expect(meetingOrganizerLabel(null, "ada@x.y")).toBe("ada@x.y");
    expect(meetingOrganizerLabel(null, null)).toBeNull();
  });
});

describe("meetingWhenLabel", () => {
  it("uses the civil date for all-day events", () => {
    expect(
      meetingWhenLabel("2026-08-20T00:00:00.000Z", null, true, "UTC"),
    ).toBe("Thursday, August 20");
  });

  it("shows a timed range with a hyphen", () => {
    expect(
      meetingWhenLabel(
        "2026-08-20T14:00:00.000Z",
        "2026-08-20T15:30:00.000Z",
        false,
        "UTC",
      ),
    ).toBe("Thursday, August 20 14:00-15:30");
  });
});

describe("meetingResponseFromAttendees", () => {
  it("reads replica partstat on self", () => {
    expect(
      meetingResponseFromAttendees([
        { email: "me@x.y", partstat: "TENTATIVE", self: true },
      ]),
    ).toBe("tentative");
  });

  it("reads Google self responseStatus", () => {
    expect(
      meetingResponseFromAttendees([
        { email: "other@x.y", responseStatus: "declined" },
        { email: "me@x.y", responseStatus: "accepted", self: true },
      ]),
    ).toBe("accepted");
  });

  it("returns null when nobody has a known status", () => {
    expect(meetingResponseFromAttendees(null)).toBeNull();
    expect(
      meetingResponseFromAttendees([{ email: "me@x.y", self: true }]),
    ).toBeNull();
  });
});
