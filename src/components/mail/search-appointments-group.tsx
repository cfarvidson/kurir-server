import Link from "next/link";
import { CalendarDays } from "lucide-react";
import {
  civilFromZoned,
  formatDateParam,
} from "@/lib/calendar/view-time";
import type { PersonAppointment } from "@/lib/mail/person-appointments";

function dayHref(startAt: Date, timeZone: string): string {
  return `/calendar/day?date=${formatDateParam(civilFromZoned(startAt, timeZone))}`;
}

function when(startAt: Date, isAllDay: boolean): string {
  if (isAllDay) {
    return startAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }) + " · All-day";
  }
  return startAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SearchAppointmentsGroup({
  appointments,
  timeZone,
}: {
  appointments: PersonAppointment[];
  timeZone: string;
}) {
  if (appointments.length === 0) return null;
  return (
    <div className="border-t px-4 py-3 md:px-6">
      <h3 className="eyebrow mb-1 text-muted-foreground">Appointments</h3>
      <ul>
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <Link
              href={dayHref(new Date(appointment.startAt), timeZone)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {appointment.title}
                </span>
                <span className="block truncate text-xs tabular-nums text-muted-foreground">
                  {when(new Date(appointment.startAt), appointment.isAllDay)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
