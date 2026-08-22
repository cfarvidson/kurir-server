# Calendar (kurir-server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web calendar client that replicas Google, Microsoft, and CalDAV into Postgres, shows week/day/month in Kurir's editorial chrome, writes back, and RSVPs meeting invites from the thread.

**Architecture:** Pure expand/ICS/RSVP/range helpers first. Prisma replica. Three adapters behind one interface. BullMQ `sync-calendar` every 120s. Web and `/api/mobile/calendar/*` read Postgres only.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, BullMQ, Vitest, `rrule`, `ical.js`, `googleapis`, `@microsoft/microsoft-graph-client`, `tsdav`.

**Spec:** `docs/specs/2026-08-20-calendar-design.md`

## Global Constraints

- UI strings in English. No em dashes in comments or copy.
- DESIGN.md: no avatars, no pill badges, Playfair only on mastheads/empty titles, terracotta is the one loud accent, `tabular-nums` on times, no resting-surface shadow.
- Tokens on `CalendarAccount`, never on `EmailConnection`.
- UI never calls Google/Graph/CalDAV. Reads are Postgres.
- Mail sync (`sync-connection`) must not share the calendar lock or queue.
- Bad ICS must not throw out of `processMessage`.
- `isDemoInstance()`: calendar worker returns immediately. No provider HTTP. RSVP is local.
- All queries filter `userId`.
- TDD: failing test first. `pnpm test <file>`. Never `git add -A`.
- Migration `0015_calendar.sql` is idempotent. Do not `prisma db push` on non-empty DBs.
- No calendar MCP tools. No Kurir reminders. No webhooks. No `webcal://`.
- `c` stays compose. Calendar create is `n` on `/calendar`. Shortcut `g e`.

---

## Files

- Create: `src/lib/calendar/expand.ts`
- Create: `src/lib/calendar/ics.ts`
- Create: `src/lib/calendar/range.ts`
- Create: `src/lib/calendar/rsvp-route.ts`
- Create: `src/lib/calendar/providers/types.ts`
- Create: `src/lib/calendar/providers/map-google.ts`
- Create: `src/lib/calendar/providers/map-graph.ts`
- Create: `src/lib/calendar/providers/map-caldav.ts`
- Create: `src/lib/calendar/providers/google.ts`
- Create: `src/lib/calendar/providers/microsoft.ts`
- Create: `src/lib/calendar/providers/caldav.ts`
- Create: `src/lib/calendar/apply-pull.ts`
- Create: `src/lib/calendar/sync-lock.ts`
- Create: `src/lib/calendar/write.ts`
- Create: `src/lib/calendar/rsvp.ts`
- Create: `src/lib/calendar/itip.ts`
- Create: `src/lib/calendar/oauth.ts`
- Create: `src/lib/calendar/accounts.ts`
- Create: `src/lib/calendar/query.ts`
- Create: `src/lib/jobs/calendar-sync-worker.ts`
- Create: `src/actions/calendar.ts`
- Create: `src/app/(mail)/calendar/page.tsx`
- Create: `src/app/(mail)/calendar/day/page.tsx`
- Create: `src/app/(mail)/calendar/month/page.tsx`
- Create: `src/components/calendar/calendar-shell.tsx`
- Create: `src/components/calendar/week-view.tsx`
- Create: `src/components/calendar/day-view.tsx`
- Create: `src/components/calendar/month-view.tsx`
- Create: `src/components/calendar/event-block.tsx`
- Create: `src/components/calendar/event-dialog.tsx`
- Create: `src/components/calendar/calendar-list.tsx`
- Create: `src/components/calendar/meeting-card.tsx`
- Create: `src/components/settings/calendar-accounts.tsx`
- Create: `src/app/api/calendar/oauth/start/route.ts`
- Create: `src/app/api/calendar/oauth/callback/route.ts`
- Create: `src/app/api/mobile/calendar/accounts/route.ts`
- Create: `src/app/api/mobile/calendar/accounts/caldav/route.ts`
- Create: `src/app/api/mobile/calendar/accounts/[id]/route.ts`
- Create: `src/app/api/mobile/calendar/calendars/[id]/route.ts`
- Create: `src/app/api/mobile/calendar/sync/route.ts`
- Create: `src/app/api/mobile/calendar/range/route.ts`
- Create: `src/app/api/mobile/calendar/events/route.ts`
- Create: `src/app/api/mobile/calendar/events/[id]/route.ts`
- Create: `src/app/api/mobile/calendar/rsvp/route.ts`
- Create: `prisma/migrations/0015_calendar.sql`
- Create: `src/__tests__/unit/calendar-expand.test.ts`
- Create: `src/__tests__/unit/calendar-ics.test.ts`
- Create: `src/__tests__/unit/calendar-range.test.ts`
- Create: `src/__tests__/unit/calendar-rsvp-route.test.ts`
- Create: `src/__tests__/unit/calendar-map-google.test.ts`
- Create: `src/__tests__/unit/calendar-apply-pull.test.ts`
- Create: `src/__tests__/unit/calendar-sync-lock.test.ts`
- Create: `src/__tests__/unit/calendar-write.test.ts`
- Create: `src/__tests__/unit/calendar-rsvp.test.ts`
- Create: `src/__tests__/fixtures/ics/google-request.ics`
- Create: `src/__tests__/fixtures/ics/outlook-request.ics`
- Create: `src/__tests__/fixtures/ics/cancel.ics`
- Create: `src/__tests__/fixtures/ics/all-day.ics`
- Create: `src/__tests__/fixtures/ics/recurring-instance.ics`
- Create: `src/__tests__/fixtures/ics/garbage.ics`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/jobs/queue.ts`
- Modify: `src/lib/mail/background-sync.ts`
- Modify: `src/lib/mail/sync-service.ts` (`processMessage`)
- Modify: `src/lib/mail/send.ts` only if iTIP cannot send via a dedicated helper. Prefer `src/lib/calendar/itip.ts` using the same SMTP credentials, not a new compose path.
- Modify: `src/components/layout/navigation.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/mail/keyboard-shortcuts.tsx`
- Modify: `src/components/mail/command-palette.tsx`
- Modify: `src/components/settings/settings-tabs.tsx`
- Modify: `src/app/(mail)/settings/page.tsx`
- Modify: `src/components/mail/thread-page-content.tsx` (or the message pane that renders the body)
- Modify: `src/actions/wipe.ts`
- Modify: `scripts/seed-demo-screenshots.ts`
- Modify: `package.json` (deps)

---

### Task 1: Event expansion

**Files:**
- Create: `src/lib/calendar/expand.ts`
- Test: `src/__tests__/unit/calendar-expand.test.ts`

**Interfaces:**
- Consumes: `rrule`
- Produces:

```ts
export const INSTANCE_PAST_MONTHS = 2;
export const INSTANCE_FUTURE_MONTHS = 18;

export type Transparency = "busy" | "free";
export type EventStatus = "confirmed" | "tentative" | "cancelled";

export type EventMaster = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  transparency: Transparency;
  status: EventStatus;
};

export type EventException = {
  masterEventId: string;
  recurrenceId: Date;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  title: string;
};

export type EventInstance = {
  eventId: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  title: string;
};

export function instanceWindow(now: Date): { from: Date; to: Date };
export function expandEventWindow(
  master: EventMaster,
  exceptions: EventException[],
  from: Date,
  to: Date,
): EventInstance[];
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  expandEventWindow,
  instanceWindow,
  type EventMaster,
} from "@/lib/calendar/expand";

const timed: EventMaster = {
  id: "m1",
  title: "Standup",
  startAt: new Date("2026-08-17T08:00:00.000Z"),
  endAt: new Date("2026-08-17T08:15:00.000Z"),
  isAllDay: false,
  timezone: "UTC",
  rrule: "FREQ=DAILY;COUNT=5",
  rdate: null,
  exdate: null,
  transparency: "busy",
  status: "confirmed",
};

describe("instanceWindow", () => {
  it("is now minus 2 months through now plus 18 months", () => {
    const { from, to } = instanceWindow(new Date("2026-08-20T12:00:00.000Z"));
    expect(from.toISOString()).toBe("2026-06-20T12:00:00.000Z");
    expect(to.toISOString()).toBe("2028-02-20T12:00:00.000Z");
  });
});

describe("expandEventWindow", () => {
  it("returns the single interval when rrule is null", () => {
    const rows = expandEventWindow(
      { ...timed, rrule: null },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startAt.toISOString()).toBe("2026-08-17T08:00:00.000Z");
    expect(rows[0]?.isException).toBe(false);
  });

  it("expands a daily RRULE inside the window", () => {
    const rows = expandEventWindow(
      timed,
      [],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(5);
  });

  it("drops EXDATE occurrences", () => {
    const rows = expandEventWindow(
      { ...timed, exdate: "20260818T080000Z" },
      [],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(rows.map((r) => r.startAt.toISOString())).not.toContain(
      "2026-08-18T08:00:00.000Z",
    );
  });

  it("overlays an exception on the matching recurrenceId", () => {
    const rows = expandEventWindow(
      timed,
      [
        {
          masterEventId: "m1",
          recurrenceId: new Date("2026-08-18T08:00:00.000Z"),
          startAt: new Date("2026-08-18T09:00:00.000Z"),
          endAt: new Date("2026-08-18T09:15:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          title: "Standup (moved)",
        },
      ],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    const moved = rows.find(
      (r) => r.startAt.toISOString() === "2026-08-18T09:00:00.000Z",
    );
    expect(moved?.isException).toBe(true);
    expect(moved?.title).toBe("Standup (moved)");
  });

  it("does not zone-shift all-day civil dates", () => {
    const rows = expandEventWindow(
      {
        id: "m2",
        title: "Holiday",
        startAt: new Date("2026-08-20T00:00:00.000Z"),
        endAt: new Date("2026-08-21T00:00:00.000Z"),
        isAllDay: true,
        timezone: null,
        rrule: null,
        rdate: null,
        exdate: null,
        transparency: "busy",
        status: "confirmed",
      },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows[0]?.startAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(rows[0]?.endAt.toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(rows[0]?.isAllDay).toBe(true);
  });

  it("returns no rows when the master is cancelled", () => {
    const rows = expandEventWindow(
      { ...timed, status: "cancelled", rrule: null },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-expand.test.ts`

Expected: FAIL, cannot find module `@/lib/calendar/expand`

- [ ] **Step 3: Write minimal implementation**

`instanceWindow` uses `Date.UTC` month arithmetic (`setUTCMonth`). All-day masters with no RRULE return one instance using `startAt`/`endAt` as stored. Timed RRULE uses `rrule` with `dtstart = master.startAt`. Duration is `endAt - startAt` copied onto each occurrence. EXDATE is parsed as UTC date-times. Exceptions replace the occurrence whose start equals `recurrenceId`. `status === "cancelled"` on the master yields `[]`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/calendar-expand.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/expand.ts src/__tests__/unit/calendar-expand.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add calendar RRULE expansion"
```

Add `rrule` in this task (`pnpm add rrule`).

---

### Task 2: ICS parse

**Files:**
- Create: `src/lib/calendar/ics.ts`
- Create: fixtures under `src/__tests__/fixtures/ics/`
- Test: `src/__tests__/unit/calendar-ics.test.ts`

**Interfaces:**
- Consumes: `ical.js`
- Produces:

```ts
export type IcsMethod =
  | "REQUEST"
  | "CANCEL"
  | "REPLY"
  | "PUBLISH"
  | "COUNTER";

export type ParsedIcs = {
  uid: string;
  method: IcsMethod;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isAllDay: boolean;
  location: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  recurrenceId: Date | null;
  rrule: string | null;
};

export function isCalendarPart(
  contentType: string,
  filename: string | null,
): boolean;
export function parseIcs(raw: string): ParsedIcs | null;
```

- [ ] **Step 1: Write fixtures and failing tests**

`google-request.ics`:

```
BEGIN:VCALENDAR
METHOD:REQUEST
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260820T140000Z
DTEND:20260820T150000Z
DTSTAMP:20260819T120000Z
ORGANIZER;CN=Ada:mailto:ada@x.y
UID:g-uid-1@google.com
SUMMARY:Design review
LOCATION:Room 4
END:VEVENT
END:VCALENDAR
```

`all-day.ics`: `DTSTART;VALUE=DATE:20260820` and `DTEND;VALUE=DATE:20260821`.

`cancel.ics`: `METHOD:CANCEL`, same UID.

`recurring-instance.ics`: `RRULE:FREQ=WEEKLY` plus `RECURRENCE-ID:20260820T140000Z`.

`garbage.ics`: `not ics at all`.

`outlook-request.ics`: `METHOD:REQUEST`, `DTSTART;TZID=W. Europe Standard Time:20260820T160000`.

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseIcs, isCalendarPart } from "@/lib/calendar/ics";

function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, "../fixtures/ics", name),
    "utf8",
  );
}

describe("isCalendarPart", () => {
  it("matches text/calendar and .ics filenames", () => {
    expect(isCalendarPart("text/calendar", null)).toBe(true);
    expect(isCalendarPart("application/octet-stream", "invite.ics")).toBe(
      true,
    );
    expect(isCalendarPart("image/png", "photo.png")).toBe(false);
  });
});

describe("parseIcs", () => {
  it("parses a Google REQUEST", () => {
    const parsed = parseIcs(fixture("google-request.ics"));
    expect(parsed?.uid).toBe("g-uid-1@google.com");
    expect(parsed?.method).toBe("REQUEST");
    expect(parsed?.title).toBe("Design review");
    expect(parsed?.location).toBe("Room 4");
    expect(parsed?.organizerEmail).toBe("ada@x.y");
    expect(parsed?.isAllDay).toBe(false);
  });

  it("parses Outlook TZID starts", () => {
    const parsed = parseIcs(fixture("outlook-request.ics"));
    expect(parsed?.method).toBe("REQUEST");
    expect(parsed?.startAt).toBeInstanceOf(Date);
  });

  it("marks VALUE=DATE as all-day with exclusive end", () => {
    const parsed = parseIcs(fixture("all-day.ics"));
    expect(parsed?.isAllDay).toBe(true);
    expect(parsed?.startAt?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(parsed?.endAt?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("parses CANCEL", () => {
    expect(parseIcs(fixture("cancel.ics"))?.method).toBe("CANCEL");
  });

  it("keeps RECURRENCE-ID on an instance invite", () => {
    const parsed = parseIcs(fixture("recurring-instance.ics"));
    expect(parsed?.recurrenceId).toBeInstanceOf(Date);
  });

  it("returns null for garbage", () => {
    expect(parseIcs(fixture("garbage.ics"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-ics.test.ts`

Expected: FAIL, cannot find module

- [ ] **Step 3: Write minimal implementation**

`isCalendarPart`: content type starts with `text/calendar` (ignore parameters) or filename lowercased ends with `.ics`.

`parseIcs`: wrap `ical.js` in try/catch, return null on throw or missing UID. METHOD defaults to `PUBLISH` if absent. Organizer CN + mailto.

`pnpm add ical.js`

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/calendar-ics.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/ics.ts src/__tests__/unit/calendar-ics.test.ts src/__tests__/fixtures/ics package.json pnpm-lock.yaml
git commit -m "feat: parse calendar invites from ICS"
```

---

### Task 3: Range, freetime, all-day bounds

**Files:**
- Create: `src/lib/calendar/range.ts`
- Test: `src/__tests__/unit/calendar-range.test.ts`

**Interfaces:**
- Consumes: `instanceWindow` from `expand.ts`
- Produces:

```ts
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean;
export function needsOnTheFlyExpand(
  from: Date,
  to: Date,
  window: { from: Date; to: Date },
): boolean;
export function allDayUtcBounds(
  startDate: string,
  endDateExclusive: string,
): { startAt: Date; endAt: Date };
export function freetimeSpans(
  instances: {
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    isCancelled: boolean;
    transparency: "busy" | "free";
  }[],
  dayStart: Date,
  dayEnd: Date,
  minMinutes: number,
): { startAt: Date; endAt: Date }[];
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  overlaps,
  needsOnTheFlyExpand,
  allDayUtcBounds,
  freetimeSpans,
} from "@/lib/calendar/range";

describe("overlaps", () => {
  it("is half-open: touching ends do not overlap", () => {
    expect(
      overlaps(
        new Date("2026-08-20T08:00:00.000Z"),
        new Date("2026-08-20T09:00:00.000Z"),
        new Date("2026-08-20T09:00:00.000Z"),
        new Date("2026-08-20T10:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("needsOnTheFlyExpand", () => {
  const window = {
    from: new Date("2026-06-20T00:00:00.000Z"),
    to: new Date("2028-02-20T00:00:00.000Z"),
  };
  it("is true when the query starts before the window", () => {
    expect(
      needsOnTheFlyExpand(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-31T00:00:00.000Z"),
        window,
      ),
    ).toBe(true);
  });
  it("is false when the query sits inside", () => {
    expect(
      needsOnTheFlyExpand(
        new Date("2026-08-17T00:00:00.000Z"),
        new Date("2026-08-24T00:00:00.000Z"),
        window,
      ),
    ).toBe(false);
  });
});

describe("allDayUtcBounds", () => {
  it("uses exclusive end", () => {
    const b = allDayUtcBounds("2026-08-20", "2026-08-21");
    expect(b.startAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(b.endAt.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});

describe("freetimeSpans", () => {
  const dayStart = new Date("2026-08-20T07:00:00.000Z");
  const dayEnd = new Date("2026-08-20T21:00:00.000Z");
  it("labels a 3-hour hole and ignores free/cancelled/all-day", () => {
    const spans = freetimeSpans(
      [
        {
          startAt: new Date("2026-08-20T08:00:00.000Z"),
          endAt: new Date("2026-08-20T09:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "busy",
        },
        {
          startAt: new Date("2026-08-20T12:00:00.000Z"),
          endAt: new Date("2026-08-20T13:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "busy",
        },
        {
          startAt: new Date("2026-08-20T10:00:00.000Z"),
          endAt: new Date("2026-08-20T11:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "free",
        },
      ],
      dayStart,
      dayEnd,
      120,
    );
    expect(spans).toEqual([
      {
        startAt: new Date("2026-08-20T09:00:00.000Z"),
        endAt: new Date("2026-08-20T12:00:00.000Z"),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-range.test.ts`

Expected: FAIL, cannot find module

- [ ] **Step 3: Write minimal implementation**

`overlaps`: `aStart < bEnd && bStart < aEnd`.

`needsOnTheFlyExpand`: `from < window.from || to > window.to`.

`allDayUtcBounds`: `new Date(`${startDate}T00:00:00.000Z`)`.

`freetimeSpans`: clip busy timed non-cancelled instances to `[dayStart, dayEnd]`, sort, walk gaps, keep gaps `>= minMinutes`. All-day and `transparency === "free"` do not occupy.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/calendar-range.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/range.ts src/__tests__/unit/calendar-range.test.ts
git commit -m "feat: add calendar range and freetime helpers"
```

---

### Task 4: RSVP routing (pure)

**Files:**
- Create: `src/lib/calendar/rsvp-route.ts`
- Test: `src/__tests__/unit/calendar-rsvp-route.test.ts`

**Interfaces:**
- Produces:

```ts
export type CalendarProviderKind = "GOOGLE" | "MICROSOFT" | "CALDAV";

export function rsvpSendsItip(provider: CalendarProviderKind): boolean;

export type RsvpCalendarCandidate = {
  id: string;
  isReadOnly: boolean;
  isPrimary: boolean;
  isVisible: boolean;
  principalEmail: string | null;
};

export function resolveRsvpCalendar(
  calendars: RsvpCalendarCandidate[],
  messageAccountEmail: string,
  aliases: string[],
  explicitCalendarId?: string,
): string | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-rsvp-route.test.ts`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`rsvpSendsItip`: `provider === "CALDAV"`.

`resolveRsvpCalendar`: if `explicitCalendarId`, return it only when that row exists and `!isReadOnly`. Else match `principalEmail` against `messageAccountEmail` or `aliases` (case-insensitive), pick `isPrimary && !isReadOnly`, else first `!isReadOnly && isVisible`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/calendar-rsvp-route.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/rsvp-route.ts src/__tests__/unit/calendar-rsvp-route.test.ts
git commit -m "feat: add calendar RSVP routing helpers"
```

---

### Task 5: Prisma schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0015_calendar.sql`

**Interfaces:**
- Produces: models `CalendarAccount`, `Calendar`, `CalendarEvent`, `CalendarEventInstance`, `MessageMeeting`, `CalendarTombstone`. Enum `CalendarProvider`. Relations on `User`, `EmailConnection` (`calendarAccounts` on-delete SetNull), `Message` (`meeting`).

- [ ] **Step 1: Add models to `schema.prisma`**

`CalendarProvider` enum: `GOOGLE`, `MICROSOFT`, `CALDAV`.

`CalendarAccount` fields exactly as the spec: tokens encrypted strings, CalDAV url/username/password, `isSyncing`, `syncLockToken`, `syncLockAt`, `lastSyncedAt`, `lastError`, `principalEmail`, optional `emailConnectionId`.

`Calendar`: unique `(accountId, providerCalendarId)`, `lastError`, `syncToken`, `ctag`, `isVisible` default true.

`CalendarEvent`: unique `(calendarId, providerEventId)`, indexes `(userId, icalUid)`, `masterEventId`, `recurrenceId`.

`CalendarEventInstance`: indexes from the spec. On-delete cascade from event.

`MessageMeeting`: unique `messageId`, on-delete cascade from message.

`CalendarTombstone`: unique `(userId, eventId)`.

Every table: `userId` with cascade from `User`.

- [ ] **Step 2: Write `0015_calendar.sql`**

Idempotent: `DO $$ BEGIN CREATE TYPE "CalendarProvider" AS ENUM (...); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

`CREATE TABLE IF NOT EXISTS` for each table, `CREATE UNIQUE INDEX IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded `ALTER TABLE ... ADD CONSTRAINT` FKs matching `0013_mcp.sql`.

- [ ] **Step 3: Generate client**

Run: `pnpm db:generate`

Expected: client includes the new models.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0015_calendar.sql
git commit -m "feat: add calendar replica schema"
```

No tests in this task. The next task compiles against the client.

---

### Task 6: Provider DTOs and mappers

**Files:**
- Create: `src/lib/calendar/providers/types.ts`
- Create: `src/lib/calendar/providers/map-google.ts`
- Create: `src/lib/calendar/providers/map-graph.ts`
- Create: `src/lib/calendar/providers/map-caldav.ts`
- Test: `src/__tests__/unit/calendar-map-google.test.ts`

**Interfaces:**
- Consumes: `allDayUtcBounds` from `range.ts`
- Produces:

```ts
export type RecurrenceEdit = "this" | "thisAndFollowing" | "all";

export type RemoteCalendar = {
  providerCalendarId: string;
  name: string;
  color: string | null;
  isPrimary: boolean;
  isReadOnly: boolean;
  timezone: string | null;
};

export type RemoteEvent = {
  providerEventId: string;
  icalUid: string | null;
  etag: string | null;
  sequence: number;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  transparency: "busy" | "free";
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  masterProviderEventId: string | null;
  recurrenceId: Date | null;
  organizerJson: unknown;
  attendeesJson: unknown;
  rawJson: unknown;
};

export type EventInput = {
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
};

export type PullResult = {
  upserts: RemoteEvent[];
  deletedProviderIds: string[];
  cursor: string | null;
  reset: boolean;
  complete: boolean;
};

export interface CalendarAdapter {
  listCalendars(): Promise<RemoteCalendar[]>;
  pull(calendar: { providerCalendarId: string; syncToken: string | null }, cursor: string | null): Promise<PullResult>;
  createEvent(calendar: { providerCalendarId: string }, input: EventInput): Promise<RemoteEvent>;
  updateEvent(
    calendar: { providerCalendarId: string },
    event: { providerEventId: string; etag: string | null; recurrenceId: Date | null },
    input: EventInput,
    range: RecurrenceEdit,
  ): Promise<RemoteEvent>;
  deleteEvent(
    calendar: { providerCalendarId: string },
    event: { providerEventId: string; etag: string | null; recurrenceId: Date | null },
    range: RecurrenceEdit,
  ): Promise<void>;
  respond(
    calendar: { providerCalendarId: string },
    event: { providerEventId: string },
    status: "accepted" | "tentative" | "declined",
  ): Promise<RemoteEvent>;
}

export function mapGoogleEvent(raw: unknown): RemoteEvent;
export function mapGraphEvent(raw: unknown): RemoteEvent;
export function mapCalDavEvent(raw: unknown): RemoteEvent;
```

`PullResult.complete === true` means delete-missing is allowed (Google/Graph/CalDAV sync-collection). `complete === false` for a windowed CalDAV `calendar-query`.

- [ ] **Step 1: Write failing mapper tests**

Google all-day `{ start: { date: "2026-08-20" }, end: { date: "2026-08-21" }, status: "confirmed", summary: "Off", id: "e1", iCalUID: "u1" }` maps to `isAllDay true` and exclusive end. Timed `{ start: { dateTime: "2026-08-20T14:00:00Z" }, end: { dateTime: "2026-08-20T15:00:00Z" } }` is not all-day. `transparency: "transparent"` maps to `free`. `recurringEventId` + `originalStartTime` maps to exception fields. `status: "cancelled"` maps to cancelled.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-map-google.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement mappers**

Google `date` uses `allDayUtcBounds`. Graph `isAllDay` plus `start.dateTime`. CalDAV uses `ical.js` VEVENT already parsed by Task 2's helpers where possible.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/calendar-map-google.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/providers src/__tests__/unit/calendar-map-google.test.ts
git commit -m "feat: add calendar provider DTOs and mappers"
```

---

### Task 7: Apply pull to the replica

**Files:**
- Create: `src/lib/calendar/apply-pull.ts`
- Test: `src/__tests__/unit/calendar-apply-pull.test.ts`

**Interfaces:**
- Consumes: `PullResult`, `expandEventWindow`, `instanceWindow`
- Produces:

```ts
export async function applyPull(input: {
  userId: string;
  accountId: string;
  calendarId: string;
  pull: PullResult;
  now: Date;
}): Promise<{ upserted: number; deleted: number }>;
```

Mock `db` like `sync-lock.test.ts`. When `pull.complete` is false, never call `deleteMany` except for `deletedProviderIds`. When true, delete replica events whose `providerEventId` is not in the upsert set and not listed as kept (the function should delete ids in `deletedProviderIds` always, and on `complete` also delete ids missing from `upserts`). Rebuild instances only for touched masters: delete instances for those event ids, insert `expandEventWindow` rows inside `instanceWindow(now)`. Write `CalendarTombstone` for each deleted master.

- [ ] **Step 1: Write failing tests** (mock db calendarEvent.findMany/upsert/deleteMany, calendarEventInstance.deleteMany/createMany, calendarTombstone.createMany)

Cases: incomplete pull does not mass-delete; complete pull deletes missing; instances rebuilt for upserted master.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-apply-pull.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement `applyPull`**

- [ ] **Step 4: Run tests and make sure they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/apply-pull.ts src/__tests__/unit/calendar-apply-pull.test.ts
git commit -m "feat: apply calendar pull results to the replica"
```

---

### Task 8: Calendar sync lock

**Files:**
- Create: `src/lib/calendar/sync-lock.ts`
- Test: `src/__tests__/unit/calendar-sync-lock.test.ts`

**Interfaces:**
- Consumes: `STALE_LOCK_MS = 5 * 60 * 1000` (copy the constant, do not import from `src/lib/mail/sync-lock.ts`)
- Produces: `claimCalendarSyncLock(accountId)`, `heartbeatCalendarSyncLock(accountId)`, `releaseCalendarSyncLock(accountId, error?: string)` using `CalendarAccount.isSyncing` / `syncLockAt` / `syncLockToken` / `lastError` / `lastSyncedAt`. Atomic `updateMany` like mail. Success release sets `lastSyncedAt` and clears `lastError`. Failure release sets `lastError` and does not advance `lastSyncedAt`.

- [ ] **Step 1: Copy the mail lock tests, pointed at `db.calendarAccount`**

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/calendar-sync-lock.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and make sure they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/sync-lock.ts src/__tests__/unit/calendar-sync-lock.test.ts
git commit -m "feat: add calendar account sync lock"
```

---

### Task 9: Google adapter

**Files:**
- Create: `src/lib/calendar/providers/google.ts`

**Interfaces:**
- Consumes: `googleapis`, `mapGoogleEvent`, `CalendarAdapter`
- Produces: `createGoogleAdapter(tokens: { accessToken: string }): CalendarAdapter`

`listCalendars`: `calendarList.list`. `pull`: `events.list` with `singleEvents: false`. If `syncToken` set, send it and no timeMin. On 410, full list and `reset: true`, `complete: true`. `createEvent`/`updateEvent`/`deleteEvent`/`respond` via events.insert/patch/delete and attendee `responseStatus`. Recurrence `this` patches the instance id. `thisAndFollowing` splits the series (patch master UNTIL, insert new series). `all` patches master.

- [ ] **Step 1: Unit-test the adapter with `vi.mock("googleapis")`** covering list, incremental pull, 410 reset, create.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement** (`pnpm add googleapis`)

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/providers/google.ts src/__tests__/unit/calendar-google-adapter.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add Google Calendar adapter"
```

No live HTTP.

---

### Task 10: Microsoft adapter

**Files:**
- Create: `src/lib/calendar/providers/microsoft.ts`

Same shape as Task 9. Graph `GET /me/calendars`, delta on `/me/calendars/{id}/events` (not calendarView). `respond` uses `/accept` `/tentativelyAccept` `/decline`. `pnpm add @microsoft/microsoft-graph-client`. Mock the client. Commit `feat: add Microsoft Graph calendar adapter`.

---

### Task 11: CalDAV adapter

**Files:**
- Create: `src/lib/calendar/providers/caldav.ts`

`pnpm add tsdav`. Discover `.well-known/caldav` then calendar-home. Prefer `syncCollection`; fall back to `calendarQuery` over `instanceWindow` with `complete: false`. PUT with `If-Match` etag. 412 throws a `CalendarConflictError`. `respond` updates PARTSTAT in the VEVENT. Mock `tsdav`. Commit `feat: add CalDAV calendar adapter`.

---

### Task 12: Writes

**Files:**
- Create: `src/lib/calendar/write.ts`
- Test: `src/__tests__/unit/calendar-write.test.ts`

**Interfaces:**
- Produces:

```ts
export class CalendarConflictError extends Error {
  constructor(readonly providerLabel: string) {
    super(`This event changed on ${providerLabel}.`);
    this.name = "CalendarConflictError";
  }
}

export async function createEventForUser(userId: string, calendarId: string, input: EventInput): Promise<{ id: string }>;
export async function updateEventForUser(userId: string, eventId: string, input: EventInput, range: RecurrenceEdit): Promise<void>;
export async function deleteEventForUser(userId: string, eventId: string, range: RecurrenceEdit): Promise<void>;
```

Load calendar + account, refuse `isReadOnly` with an error status 403. Optimistic replica update, adapter call, on success store etag/provider id and rebuild instances. On `CalendarConflictError` re-pull that event via `adapter.pull` is too broad: re-fetch the single event if the adapter exposes it, else `applyPull` of a one-id upsert after `events.get`. On other errors roll back the snapshot taken before the optimistic write.

Cross-account move: throw 400. Same-account calendar change: adapter move then update `calendarId`.

- [ ] **Step 1: Tests with mocked adapter + db** for create, 403 read-only, 412 conflict message `This event changed on Google.`, rollback on generic throw, `this` vs `all` delete.

- [ ] **Step 2-5:** implement, pass, commit `feat: add calendar write-through helpers`

---

### Task 13: Worker and queue

**Files:**
- Modify: `src/lib/jobs/queue.ts` add `CALENDAR_SYNC_QUEUE = "sync-calendar"`, `getCalendarSyncQueue()`, include it in `closeQueues`
- Create: `src/lib/jobs/calendar-sync-worker.ts`
- Modify: `src/lib/mail/background-sync.ts`

Worker job data `{ calendarAccountId: string; userId: string }`. `isDemoInstance()` returns immediately. Claim lock, refresh OAuth (set `oauthError` on failure and stop), `listCalendars` upsert, pull each calendar, `applyPull`, per-calendar `lastError` on failure, release lock. Repeat every `120_000`, `jobId: calendar-sync-${accountId}`.

`startBackgroundSync` starts this worker and `scheduleCalendarSyncJobs` next to mail. Demo path still skips all workers.

Tombstone prune: add a maintenance task `prune-calendar-tombstones` daily deleting `deletedAt < now-30d`. Fold into `maintenance-tasks.ts` / `scheduleMaintenanceJobs`.

- [ ] **Step 1:** unit-test that demo short-circuits (mock `isDemoInstance` true, adapter not called).

- [ ] **Step 2-5:** implement, commit `feat: add calendar sync worker`

---

### Task 14: Connect accounts (OAuth + CalDAV)

**Files:**
- Create: `src/lib/calendar/oauth.ts` (calendar scopes from the spec, `buildCalendarAuthorizationUrl`, `exchangeCalendarCode`, `refreshCalendarAccessToken`). Same client ids as mail via `getConfig().oauth`. Tokens stored encrypted with `encrypt` from `src/lib/crypto.ts`.
- Create: `src/lib/calendar/accounts.ts` `createCalDavAccount`, `deleteCalendarAccount` (tombstone remaining events, unschedule job)
- Create: `src/app/api/calendar/oauth/start/route.ts`
- Create: `src/app/api/calendar/oauth/callback/route.ts`
- Create: `src/actions/calendar.ts` (connect/disconnect/sync-now/set visibility)

Start route requires session, puts `{ userId, provider, redirect }` in a signed state, redirects to Google/Microsoft. Callback creates `CalendarAccount`, enqueues a sync job, redirects to `/settings?tab=calendar`.

CalDAV action: url, username, password. Discover then insert.

- [ ] **Step 1:** unit-test scope lists: Google includes `https://www.googleapis.com/auth/calendar` and does not include `https://mail.google.com/`. Microsoft includes `Calendars.ReadWrite` and does not include `IMAP.AccessAsUser.All`.

- [ ] **Step 2-5:** implement, commit `feat: connect Google, Outlook, and CalDAV calendars`

---

### Task 15: ICS ingest during mail sync

**Files:**
- Modify: `src/lib/mail/sync-service.ts` `processMessage`
- Create tests in `src/__tests__/unit/calendar-ics-ingest.test.ts` if you extract `ingestMeetingFromParsed(userId, messageId, parsed)` to `src/lib/calendar/ingest.ts`

After the message row exists, scan `parsed.attachments` and `parsed` for `text/calendar`. `parseIcs`. On null, log `[calendar-ics] skip` without the body. Else upsert `MessageMeeting`. If `uid` matches a `CalendarEvent.icalUid` for that user, set `calendarEventId`.

- [ ] **Step 1:** test ingest with a parsed-like object (contentType `text/calendar`, content the google-request fixture). Garbage does not throw.

- [ ] **Step 2-5:** implement, commit `feat: store meeting invites from mail ICS`

---

### Task 16: RSVP + iTIP

**Files:**
- Create: `src/lib/calendar/itip.ts`
- Create: `src/lib/calendar/rsvp.ts`
- Test: `src/__tests__/unit/calendar-rsvp.test.ts`

```ts
export async function rsvpToMeetingForUser(
  userId: string,
  messageId: string,
  status: "accepted" | "tentative" | "declined",
  calendarId?: string,
): Promise<void>;
```

Load `MessageMeeting` + message connection email/aliases. `resolveRsvpCalendar`. If no event for UID, `createEventForUser` from ICS fields then `adapter.respond`. `recurrenceId` set => range `this`, else `all`. If `rsvpSendsItip(provider)`, `sendItipReply` via SMTP using `getConnectionCredentials` for the message's `emailConnectionId`. Do not call `sendMailForUser` (that persists a normal Sent body). iTIP mail: `Content-Type: text/calendar; method=REPLY`, To = organizer, no dummy Sent row. Demo: replica only.

- [ ] **Step 1:** tests mock write + adapter + itip. Google path does not call itip. CalDAV does. No writable calendar throws with message `Connect a calendar to reply.`

- [ ] **Step 2-5:** implement, commit `feat: RSVP meeting invites onto a calendar`

---

### Task 17: Query + server actions for the web

**Files:**
- Create: `src/lib/calendar/query.ts`
- Modify: `src/actions/calendar.ts`

```ts
export async function listVisibleInstancesForUser(
  userId: string,
  from: Date,
  to: Date,
): Promise<Array<EventInstance & { calendarId: string; color: string; calendarName: string }>>;
```

Hidden calendars excluded. If `needsOnTheFlyExpand`, expand masters whose RRULE might overlap (load masters with `rrule != null` or `startAt < to`) rather than only the instance table.

Actions: `createEventAction`, `updateEventAction`, `deleteEventAction`, `rsvpAction`, `setCalendarVisibleAction`, `syncCalendarNowAction`. Auth + ownership. `revalidatePath("/calendar")`.

- [ ] **Step 1:** unit-test query excludes `isVisible: false` and cancelled instances.

- [ ] **Step 2-5:** implement, commit `feat: add calendar queries and server actions`

---

### Task 18: Web calendar UI

**Files:** the `src/app/(mail)/calendar/**` pages and `src/components/calendar/*`

**Copy (English, exact):**

- Empty title: `Connect a calendar`
- Empty body: `Google, Outlook, or any CalDAV account. Events stay on that calendar. Kurir shows this week.`
- Buttons: `Add Google`, `Add Outlook`, `Add CalDAV`
- Freetime label: `Free`
- Recurrence prompt: `This event`, `This and following events`, `All events`
- Conflict toast: use `CalendarConflictError.message`
- Read-only note: `Subscribe`

`PageMasthead` as the spec. Week path `/calendar`, day `/calendar/day`, month `/calendar/month`, `?date=YYYY-MM-DD`. Below `md`, `/calendar` with no date still redirects to `/calendar/day` (server `headers` user-agent is wrong; do the redirect in `calendar-shell.tsx` with `window.matchMedia("(min-width: 768px)")` on first paint only when pathname is `/calendar` and search has no `view=`). Simpler and spec-faithful: the week page renders `DayView` when `useMediaQuery` is below md unless the user clicked Week (store `forcedView` in the query `?view=week|day|month`). Prefer query `view` over three routes if three routes fight the responsive default. **Keep the three routes from the spec.** `/calendar` client component: if `!md && !searchParams.has("stay")` `router.replace(/calendar/day)`. Week toggle on a phone goes to `/calendar?stay=1`.

Event chrome: 2px left rail, `color-mix(in srgb, var(--event-color) 18%, var(--background))` fill, Inter title, no shadow, no avatars. Now line: `bg-primary` 1px. Weekends `bg-muted/40`. Hours `tabular-nums`. Visible 07:00-21:00 scroll 00:00-24:00.

`n` / `t` / arrows only while pathname starts with `/calendar` and the focus is not an input. Do not bind `n` globally.

Dialog via existing `Dialog` in `src/components/ui/`. Fields from the spec. No attendee editor.

- [ ] **Step 1:** a small unit test for a pure `eventBlockStyle(hex: string)` helper in `src/lib/calendar/color.ts` that returns the rail/fill CSS variables. Then build the views.

- [ ] **Step 2-5:** implement, commit `feat: add week, day, and month calendar views`

Verify in the browser: empty state, seeded/demo week with a Free gap, create dialog, dark theme, mobile width day redirect. If no browser tools, say so.

---

### Task 19: Settings, nav, shortcuts, command palette

**Files:**
- Modify: `src/components/layout/navigation.ts` insert `{ name: "Calendar", href: "/calendar", icon: Calendar }` after Paper Trail
- Modify: `src/components/layout/sidebar.tsx` `NAV_SHORTCUTS["/calendar"] = "E"`
- Modify: `src/components/mail/keyboard-shortcuts.tsx` `{ keys: ["g", "e"], description: "Calendar", mode: "sequence" }`
- Modify: `src/components/mail/command-palette.tsx` actions `Go to Calendar` (`G`,`E`) and `New event` going to `/calendar?new=1`
- Modify: `src/components/settings/settings-tabs.tsx` add `calendar` tab
- Modify: `src/app/(mail)/settings/page.tsx` pass `calendarContent`
- Create: `src/components/settings/calendar-accounts.tsx`

PWA More sheet picks Calendar up from `navigation`. Do not pin it in `MobileTabBar`.

- [ ] **Step 1:** grep-level test not required. Manual: Calendar sits after Paper Trail, `g e` works, settings tab lists accounts.

- [ ] **Step 2-5:** implement, commit `feat: add calendar navigation and settings`

---

### Task 20: Meeting card on the thread

**Files:**
- Create: `src/components/calendar/meeting-card.tsx`
- Modify: the thread message pane (`thread-page-content.tsx` or the per-message renderer) to load `message.meeting` and render the card above the body

Copy: `This meeting was cancelled.` `Connect a calendar to reply.` `Show in calendar` links to `/calendar/day?date=YYYY-MM-DD`. Buttons `Accept` / `Maybe` / `Decline`. Accept uses `Button` default (terracotta). Maybe/Decline are `variant="outline"`. Organizer is `organizerName || organizerEmail`. No avatar.

- [ ] **Step 1:** render test if the repo has RTL for components; otherwise a pure `meetingCardState(method, hasCalendar, status)` helper:

```ts
export function meetingCardState(
  method: IcsMethod,
  hasWritableCalendar: boolean,
  response: "accepted" | "tentative" | "declined" | null,
): {
  showButtons: boolean;
  cancelled: boolean;
  disabledReason: string | null;
};
```

REQUEST + writable => buttons. CANCEL => cancelled, no buttons. REQUEST + !writable => no buttons, `disabledReason` = `Connect a calendar to reply.`

- [ ] **Step 2-5:** implement, commit `feat: show meeting RSVP on the thread`

---

### Task 21: Mobile API

**Files:** the `/api/mobile/calendar/**` routes listed above

Auth: `requireMobileAuth`, `rateLimitUser`, same 401 JSON as drafts. All bodies zod-validated.

| Route | Behavior |
|-------|----------|
| GET `/accounts` | accounts + calendars |
| POST `/accounts/caldav` | `{ url, username, password }` |
| DELETE `/accounts/:id` | disconnect |
| PATCH `/calendars/:id` | `{ isVisible }` |
| GET `/sync?cursor=` | delta of accounts, calendars, events, tombstones. Cursor `updatedAtISO_id` like mail. |
| GET `/range?start&end&calendarIds?` | ISO timestamps, uses `listVisibleInstancesForUser` |
| POST `/events` | EventInput + calendarId |
| PATCH `/events/:id` | EventInput + `range` |
| DELETE `/events/:id?range=` | |
| POST `/rsvp` | `{ messageId, status, calendarId? }` |

OAuth start for mobile: reuse `/api/calendar/oauth/start?mobile=1` returning `{ url }`. Callback already redirects; mobile uses the existing app callback pattern from mail OAuth if one exists, otherwise the web callback then the native client polls GET `/accounts`.

Message JSON on `GET /api/mobile/sync` and thread payloads grows optional `meeting`:

```ts
meeting: {
  uid: string;
  method: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  isAllDay: boolean;
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  calendarEventId: string | null;
} | null
```

Omit the key when no `MessageMeeting` row exists. Native Task 7 reads this field. Do not add a second meeting endpoint.

Integration tests next to `mobile-drafts.test.ts`: 401 without token, 400 invalid range, 403 write to read-only (mock write helper). Sync includes `meeting` when a row exists.

- [ ] **Step 1:** write those integration tests first.

- [ ] **Step 2-5:** implement, commit `feat: add mobile calendar API`

This task is the gate for the iOS plan.

---

### Task 22: Demo seed, wipe, privacy

**Files:**
- Modify: `scripts/seed-demo-screenshots.ts` (and any other demo user seed) to insert one `CalendarAccount` (`provider: CALDAV`, no password needed because the worker no-ops), two calendars (Personal writable color `#b45309`, Holidays read-only), events this week: a 09:00 meeting, an all-day, and a gap 10:00-13:00 with nothing so freetime shows.
- Modify: `src/actions/wipe.ts`: `wipeAllData` already cascades from User if CalendarAccount is on User. `wipeMailData` must **not** delete `CalendarAccount`. Add a comment there so the next person does not "clean it up".
- Do not log ICS bodies. Ingest log line is uid + method only.

- [ ] **Step 1: Write a failing test that demo seed inserts two calendars**

If seed is a script not imported by Vitest, extract `demoCalendarSeed(now: Date)` to `src/lib/calendar/demo-seed.ts` and test: two calendars, one all-day event, one timed event, a 3-hour gap between 10:00 and 13:00 local. `wipeMailData` in `src/actions/wipe.ts` must not call `calendarAccount.deleteMany`.

- [ ] **Step 2-5:** implement, commit `feat: seed demo calendars and keep them across mail wipe`

---

## Spec coverage

| Spec section | Tasks |
|--------------|-------|
| Replica models | 5 |
| Expansion window | 1, 7 |
| Adapters | 6, 9, 10, 11 |
| Poll 120s, own queue | 13 |
| Writes / recurrence / 412 | 12 |
| Web week/day/month / freetime / chrome | 3, 18, 19 |
| Settings / OAuth / CalDAV | 14, 19 |
| ICS + RSVP + iTIP | 2, 4, 15, 16, 20 |
| Mobile API | 21 |
| Demo / wipe | 13, 22 |
| Tests listed in spec | 1-4, 7, 8, 12, 16 |

Not in this plan (iOS plan): native views, ASWebAuthenticationSession, iOS tab.
