import {
  addDays,
  allDayRangeUtc,
  civilFromZoned,
  sameCivil,
  startOfWeekMonday,
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
  location?: string | null;
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
        location: string | null;
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

type DemoCalendarKey = "work" | "family" | "personal" | "holidays";

/**
 * Pure demo calendar plan for screenshots, relative to `now`'s week so a
 * week, month and day screenshot always look lived in.
 * Work, Family and Personal are writable; Holidays is read-only.
 * Today: 09:00-10:00 + 13:00-14:00 leave a local 10:00-13:00 freetime gap,
 * then a late-afternoon call with a meeting link and a family evening.
 */
export function demoCalendarSeed(now: Date): DemoCalendarSeed {
  const today = civilFromZoned(now, DEMO_CALENDAR_TIMEZONE);
  const monday = startOfWeekMonday(today);
  const events: Record<DemoCalendarKey, DemoSeedEvent[]> = {
    work: [],
    family: [],
    personal: [],
    holidays: [],
  };

  function add(
    key: DemoCalendarKey,
    id: string,
    title: string,
    day: CivilDate,
    at: [hour: number, minute: number, minutes: number] | "all-day",
    options: { days?: number; location?: string } = {},
  ) {
    const range =
      at === "all-day"
        ? (() => {
            const r = allDayRangeUtc(day, addDays(day, options.days ?? 1));
            return { startAt: r.startAt, endAt: r.endAt };
          })()
        : timed(day, at[0], at[1], at[2]);
    events[key].push({
      providerEventId: `demo-${id}`,
      icalUid: `demo-${id}@kurir.example`,
      title,
      startAt: range.startAt,
      endAt: range.endAt,
      isAllDay: at === "all-day",
      timezone: at === "all-day" ? null : DEMO_CALENDAR_TIMEZONE,
      location: options.location ?? null,
    });
  }

  // Today.
  add("personal", "standup", "Standup", today, [9, 0, 60]);
  add("personal", "deep-work", "Deep work", today, [13, 0, 60]);
  add("work", "design-review", "Design review", today, [17, 0, 30], {
    location: "https://meet.example.com/kurir-design",
  });
  add("family", "dinner", "Dinner with the Lindqvists", today, [18, 30, 90]);
  add("family", "school-closed", "School closed", today, "all-day");

  // The rest of this week, around today.
  const week: Array<
    [
      offset: number,
      key: DemoCalendarKey,
      title: string,
      at: [number, number, number] | "all-day",
      location?: string,
    ]
  > = [
    [0, "work", "Team standup", [9, 0, 30], "Room 2"],
    [0, "work", "Roadmap planning", [13, 0, 60]],
    [1, "work", "Team standup", [9, 0, 30], "Room 2"],
    [1, "work", "Sprint demo", [11, 30, 30]],
    [1, "work", "Sprint planning", [14, 0, 60]],
    [1, "work", "Project weekly", [15, 0, 30]],
    [1, "family", "Choir rehearsal", [18, 30, 90]],
    [2, "work", "Team standup", [9, 0, 30], "Room 2"],
    [2, "family", "Yoga", [18, 30, 75]],
    [2, "family", "Cleaning day", "all-day"],
    [3, "work", "Team standup", [9, 0, 30], "Room 2"],
    [3, "work", "Vendor sync", [11, 0, 30]],
    [3, "work", "Product review", [13, 0, 60]],
    [3, "family", "Swimming lesson", [16, 20, 40]],
    [3, "work", "Team dinner", [16, 30, 210]],
    [4, "work", "Team standup", [9, 0, 30], "Room 2"],
    [4, "work", "Architecture review", [10, 0, 60]],
    [5, "family", "Farmers market", [10, 0, 90]],
    [6, "family", "Gymnastics", [9, 0, 60]],
    [6, "family", "Lunch with grandma", [12, 30, 90]],
  ];
  week.forEach(([offset, key, title, at, location], i) => {
    const day = addDays(monday, offset);
    if (sameCivil(day, today)) return;
    add(key, `week-${i}`, title, day, at, { location });
  });
  add(
    "family",
    "grandparents",
    "Grandparents visiting",
    addDays(monday, 3),
    "all-day",
    {
      days: 4,
    },
  );

  // The surrounding weeks, so the month grid reads like real use.
  for (let w = -4; w <= 5; w++) {
    if (w === 0) continue;
    const start = addDays(monday, w * 7);
    for (let d = 0; d < 5; d++) {
      add(
        "work",
        `standup-${w}-${d}`,
        "Team standup",
        addDays(start, d),
        [9, 0, 30],
      );
    }
    add(
      "work",
      `planning-${w}`,
      "Sprint planning",
      addDays(start, 1),
      [14, 0, 60],
    );
    add(
      "work",
      `review-${w}`,
      "Product review",
      addDays(start, 3),
      [13, 0, 60],
    );
    add("family", `yoga-${w}`, "Yoga", addDays(start, 2), [18, 30, 75]);
    add("family", `gym-${w}`, "Gymnastics", addDays(start, 6), [9, 0, 60]);
    if (w % 2 === 0) {
      add(
        "family",
        `cleaning-${w}`,
        "Cleaning day",
        addDays(start, 5),
        "all-day",
      );
    }
  }
  add("work", "offsite", "Team offsite", addDays(monday, -12), "all-day", {
    days: 3,
  });
  add("personal", "dentist", "Dentist", addDays(monday, -5), [8, 0, 45]);
  add("family", "birthday", "Maja's birthday", addDays(monday, 9), "all-day");
  add("holidays", "holiday", "Public holiday", addDays(monday, 14), "all-day");

  return {
    account: {
      provider: "CALDAV",
      displayName: "Alex Berg",
      principalEmail: "alex@kurir.io",
    },
    calendars: [
      {
        providerCalendarId: "demo-work",
        name: "Work",
        color: "#5a6474",
        isPrimary: false,
        isReadOnly: false,
        events: events.work,
      },
      {
        providerCalendarId: "demo-family",
        name: "Family",
        color: "#8a3fa6",
        isPrimary: false,
        isReadOnly: false,
        events: events.family,
      },
      {
        providerCalendarId: "demo-personal",
        name: "Personal",
        color: "#b45309",
        isPrimary: true,
        isReadOnly: false,
        events: events.personal,
      },
      {
        providerCalendarId: "demo-holidays",
        name: "Holidays",
        color: "#78716c",
        isPrimary: false,
        isReadOnly: true,
        events: events.holidays,
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
          location: event.location ?? null,
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
