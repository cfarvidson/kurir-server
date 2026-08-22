import { describe, it, expect } from "vitest";
import { normalizeAttendees } from "@/lib/calendar/attendees";

describe("normalizeAttendees", () => {
  it("reads the Google shape", () => {
    expect(
      normalizeAttendees([
        {
          email: "arvid@arvidson.io",
          displayName: "Arvid",
          responseStatus: "accepted",
          self: true,
        },
        { email: "nils@example.com", responseStatus: "needsAction" },
      ]),
    ).toEqual([
      {
        email: "arvid@arvidson.io",
        name: "Arvid",
        status: "accepted",
        isSelf: true,
      },
      {
        email: "nils@example.com",
        name: null,
        status: "needsAction",
        isSelf: false,
      },
    ]);
  });

  it("reads the Microsoft Graph shape", () => {
    expect(
      normalizeAttendees([
        {
          emailAddress: { address: "lina@example.com", name: "Lina" },
          status: { response: "tentativelyAccepted" },
        },
      ]),
    ).toEqual([
      {
        email: "lina@example.com",
        name: "Lina",
        status: "tentative",
        isSelf: false,
      },
    ]);
  });

  it("reads the CalDAV shape and strips the mailto prefix", () => {
    expect(
      normalizeAttendees([
        {
          value: "mailto:erik@example.com",
          cn: "Erik",
          partstat: "DECLINED",
          role: "REQ-PARTICIPANT",
        },
      ]),
    ).toEqual([
      {
        email: "erik@example.com",
        name: "Erik",
        status: "declined",
        isSelf: false,
      },
    ]);
  });

  it("returns an empty list for null, non-arrays and junk rows", () => {
    expect(normalizeAttendees(null)).toEqual([]);
    expect(normalizeAttendees(undefined)).toEqual([]);
    expect(normalizeAttendees("nope")).toEqual([]);
    expect(normalizeAttendees({ email: "x@y.z" })).toEqual([]);
    expect(normalizeAttendees([null, 42, {}, { cn: "no email" }])).toEqual([]);
  });

  it("keeps an unknown status as null rather than guessing", () => {
    expect(
      normalizeAttendees([{ email: "x@y.z", responseStatus: "wat" }]),
    ).toEqual([{ email: "x@y.z", name: null, status: null, isSelf: false }]);
  });

  it("reads Microsoft Graph tentativelyAccepted the same way meeting-card does", () => {
    expect(
      normalizeAttendees([
        {
          emailAddress: { address: "me@x.y" },
          status: { response: "tentativelyAccepted" },
          self: true,
        },
      ]),
    ).toEqual([
      { email: "me@x.y", name: null, status: "tentative", isSelf: true },
    ]);
  });
});
