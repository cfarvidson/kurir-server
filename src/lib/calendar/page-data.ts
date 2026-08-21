import { db } from "@/lib/db";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import {
  dayRangeUtc,
  monthRangeUtc,
  parseDateParam,
  weekRangeUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";
import type {
  CalendarAccountDTO,
  CalendarInstanceDTO,
  CalendarViewMode,
} from "@/components/calendar/types";
import type { VisibleInstance } from "@/lib/calendar/query";

export type CalendarPagePayload = {
  mode: CalendarViewMode;
  timezone: string;
  dateParam: string | null;
  openNew: boolean;
  accounts: CalendarAccountDTO[];
  instances: CalendarInstanceDTO[];
  anchor: CivilDate;
};

export function serializeInstance(row: VisibleInstance): CalendarInstanceDTO {
  return {
    eventId: row.eventId,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    isAllDay: row.isAllDay,
    isException: row.isException,
    calendarId: row.calendarId,
    color: row.color,
    calendarName: row.calendarName,
    transparency: row.transparency,
    location: row.location,
    description: row.description,
    rrule: row.rrule,
    isReadOnly: row.isReadOnly,
  };
}

export async function loadCalendarPage(
  userId: string,
  mode: CalendarViewMode,
  search: { date?: string; new?: string },
): Promise<CalendarPagePayload> {
  const [user, accounts] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
    db.calendarAccount.findMany({
      where: { userId },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        provider: true,
        oauthError: true,
        lastError: true,
        calendars: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            color: true,
            isVisible: true,
            isReadOnly: true,
            isPrimary: true,
          },
        },
      },
    }),
  ]);

  const timezone = user?.timezone || "UTC";
  const dateParam = search.date ?? null;
  const anchor = parseDateParam(dateParam, timezone);
  const range =
    mode === "week"
      ? weekRangeUtc(anchor, timezone)
      : mode === "month"
        ? monthRangeUtc(anchor, timezone)
        : { ...dayRangeUtc(anchor, timezone) };

  const instances =
    accounts.length === 0
      ? []
      : (await listVisibleInstancesForUser(userId, range.from, range.to)).map(
          serializeInstance,
        );

  return {
    mode,
    timezone,
    dateParam,
    openNew: search.new === "1",
    accounts,
    instances,
    anchor,
  };
}
