import {
  addDays,
  allDayRangeUtc,
  civilFromZoned,
  zonedWallToUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";

/** Demo user timezone (matches seed-demo-screenshots). */
export const DEMO_CALENDAR_TIMEZONE = "Europe/Stockholm";

export type DemoSeedEvent = {
  providerEventId: string;
  icalUid: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
};

export type DemoSeedCalendar = {
  providerCalendarId: string;
  name: string;
  color: string | null;
  isPrimary: boolean;
  isReadOnly: boolean;
  events: DemoSeedEvent[];
};

export type DemoCalendarSeed = {
  account: {
    provider: "CALDAV";
    displayName: string;
    principalEmail: string;
  };
  calendars: DemoSeedCalendar[];
};

type DemoSeedDb = {
  calendarAccount: {
    create: (args: {
      data: {
        userId: string;
        provider: "CALDAV";
        displayName: string;
        principalEmail: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  calendar: {
    create: (args: {
      data: {
        userId: string;
        accountId: string;
        providerCalendarId: string;
        name: string;
        color: string | null;
        isPrimary: boolean;
        isReadOnly: boolean;
        isVisible: boolean;
        timezone: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  calendarEvent: {
    create: (args: {
      data: {
        userId: string;
        calendarId: string;
        providerEventId: string;
        icalUid: string;
        title: string;
        startAt: Date;
        endAt: Date;
        isAllDay: boolean;
        timezone: string | null;
        status: string;
        transparency: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  calendarEventInstance: {
    create: (args: {
      data: {
        userId: string;
        calendarId: string;
        eventId: string;
        startAt: Date;
        endAt: Date;
        isAllDay: boolean;
        isCancelled: boolean;
        isException: boolean;
      };
    }) => Promise<unknown>;
  };
};

function timed(
  day: CivilDate,
  hour: number,
  minute: number,
  durationMinutes: number,
): { startAt: Date; endAt: Date } {
  const startAt = zonedWallToUtc(DEMO_CALENDAR_TIMEZONE, {
    ...day,
    hour,
    minute,
  });
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt };
}

/**
 * Pure demo calendar plan for screenshots.
 * Personal: writable terracotta; Holidays: read-only.
 * Timed 09:00-10:00 + 13:00-14:00 leave a local 10:00-13:00 freetime gap.
 */
export function demoCalendarSeed(now: Date): DemoCalendarSeed {
  const day = civilFromZoned(now, DEMO_CALENDAR_TIMEZONE);
  const morning = timed(day, 9, 0, 60);
  const afternoon = timed(day, 13, 0, 60);
  const allDay = allDayRangeUtc(day, addDays(day, 1));

  return {
    account: {
      provider: "CALDAV",
      displayName: "Alex Berg",
      principalEmail: "alex@kurir.io",
    },
    calendars: [
      {
        providerCalendarId: "demo-personal",
        name: "Personal",
        color: "#b45309",
        isPrimary: true,
        isReadOnly: false,
        events: [
          {
            providerEventId: "demo-standup",
            icalUid: "demo-standup@kurir.example",
            title: "Standup",
            startAt: morning.startAt,
            endAt: morning.endAt,
            isAllDay: false,
            timezone: DEMO_CALENDAR_TIMEZONE,
          },
          {
            providerEventId: "demo-deep-work",
            icalUid: "demo-deep-work@kurir.example",
            title: "Deep work",
            startAt: afternoon.startAt,
            endAt: afternoon.endAt,
            isAllDay: false,
            timezone: DEMO_CALENDAR_TIMEZONE,
          },
        ],
      },
      {
        providerCalendarId: "demo-holidays",
        name: "Holidays",
        color: "#78716c",
        isPrimary: false,
        isReadOnly: true,
        events: [
          {
            providerEventId: "demo-holiday",
            icalUid: "demo-holiday@kurir.example",
            title: "Public holiday",
            startAt: allDay.startAt,
            endAt: allDay.endAt,
            isAllDay: true,
            timezone: null,
          },
        ],
      },
    ],
  };
}

/** Persist demoCalendarSeed for a user. No CalDAV password (worker no-ops in demo). */
export async function insertDemoCalendarSeed(
  db: DemoSeedDb,
  userId: string,
  now: Date,
): Promise<void> {
  const seed = demoCalendarSeed(now);

  const account = await db.calendarAccount.create({
    data: {
      userId,
      provider: seed.account.provider,
      displayName: seed.account.displayName,
      principalEmail: seed.account.principalEmail,
    },
    select: { id: true },
  });

  for (const cal of seed.calendars) {
    const calendar = await db.calendar.create({
      data: {
        userId,
        accountId: account.id,
        providerCalendarId: cal.providerCalendarId,
        name: cal.name,
        color: cal.color,
        isPrimary: cal.isPrimary,
        isReadOnly: cal.isReadOnly,
        isVisible: true,
        timezone: DEMO_CALENDAR_TIMEZONE,
      },
      select: { id: true },
    });

    for (const event of cal.events) {
      const created = await db.calendarEvent.create({
        data: {
          userId,
          calendarId: calendar.id,
          providerEventId: event.providerEventId,
          icalUid: event.icalUid,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
          isAllDay: event.isAllDay,
          timezone: event.timezone,
          status: "confirmed",
          transparency: "busy",
        },
        select: { id: true },
      });

      await db.calendarEventInstance.create({
        data: {
          userId,
          calendarId: calendar.id,
          eventId: created.id,
          startAt: event.startAt,
          endAt: event.endAt,
          isAllDay: event.isAllDay,
          isCancelled: false,
          isException: false,
        },
      });
    }
  }
}
