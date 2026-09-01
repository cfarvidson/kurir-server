import { describe, it, expect } from "vitest";
import { appointmentMatches, type PersonAppointment } from "@/lib/mail/person-appointments";

function appt(
  title: string,
  attendees: { email: string; name: string | null }[],
): PersonAppointment {
  return {
    id: "i1",
    eventId: "e1",
    title,
    startAt: new Date(),
    endAt: new Date(),
    isAllDay: false,
    location: null,
    attendees,
  };
}

describe("appointmentMatches", () => {
  const attendees = [{ email: "ada@x.y", name: "Ada Lovelace" }];

  it("matches title or attendee", () => {
    expect(appointmentMatches(appt("Standup", attendees), "stand")).toBe(true);
    expect(appointmentMatches(appt("Sync", attendees), "ADA")).toBe(true);
    expect(appointmentMatches(appt("Sync", attendees), "love")).toBe(true);
    expect(appointmentMatches(appt("Sync", attendees), "budget")).toBe(false);
    expect(appointmentMatches(appt("Sync", attendees), "  ")).toBe(false);
  });
});
