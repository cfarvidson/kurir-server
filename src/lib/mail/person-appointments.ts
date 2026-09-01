import { db } from "@/lib/db";
import { normalizeAttendees } from "@/lib/calendar/attendees";

export type PersonAppointment = {
  id: string;
  eventId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  location: string | null;
  attendees: { email: string; name: string | null }[];
};

function ordered(
  rows: PersonAppointment[],
  now: Date,
): PersonAppointment[] {
  const upcoming = rows
    .filter((row) => row.startAt.getTime() >= now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = rows
    .filter((row) => row.startAt.getTime() < now.getTime())
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  return [...upcoming, ...past];
}

export function appointmentMatches(
  appointment: PersonAppointment,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (appointment.title.toLowerCase().includes(needle)) return true;
  return appointment.attendees.some(
    (attendee) =>
      attendee.email.toLowerCase().includes(needle) ||
      (attendee.name ?? "").toLowerCase().includes(needle),
  );
}

async function loadInstances(userId: string): Promise<PersonAppointment[]> {
  const rows = await db.calendarEventInstance.findMany({
    where: { userId, isCancelled: false },
    select: {
      id: true,
      eventId: true,
      startAt: true,
      endAt: true,
      isAllDay: true,
      event: {
        select: { title: true, location: true, attendeesJson: true },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    title: row.event.title,
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    location: row.event.location,
    attendees: normalizeAttendees(row.event.attendeesJson).map((a) => ({
      email: a.email,
      name: a.name,
    })),
  }));
}

export async function appointmentsForPerson(
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<PersonAppointment[]> {
  const lowered = email.toLowerCase();
  const rows = await loadInstances(userId);
  return ordered(
    rows.filter((row) =>
      row.attendees.some((a) => a.email.toLowerCase() === lowered),
    ),
    now,
  );
}

export async function searchAppointments(
  userId: string,
  query: string,
  now: Date = new Date(),
  limit = 5,
): Promise<PersonAppointment[]> {
  const needle = query.trim();
  if (!needle) return [];
  const rows = await loadInstances(userId);
  return ordered(
    rows.filter((row) => appointmentMatches(row, needle)),
    now,
  ).slice(0, limit);
}
