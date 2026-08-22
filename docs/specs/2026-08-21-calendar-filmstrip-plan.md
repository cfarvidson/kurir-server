# Calendar Filmstrip + Personality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the day view with a HEY-style filmstrip timeline, turn the floating "Free" word into bounded clickable freetime blocks, and warm up week/month so the calendar reads as Kurir.

**Architecture:** A new pure layout module (`filmstrip-model.ts`) turns instances + a day range into render items (events, freetime, seams, now-marker); a client `Filmstrip` component renders them as one continuous scroll with IntersectionObserver-driven windowing fed by a new `GET /api/calendar/instances` route. The week grid keeps all drag interactions and gets visual upgrades only.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, Vitest. No new dependencies.

**Spec:** `docs/specs/2026-08-21-calendar-filmstrip-design.md`

## Global Constraints

- All UI copy in English.
- No schema changes, no mobile-API changes, no new dependencies.
- DESIGN.md rules hold: no shadows, no pills, no avatars; Playfair = `font-serif`, terracotta = `primary` token; `tabular-nums` on times/dates.
- Freetime threshold: gaps >= 120 min (`FREETIME_MIN_MINUTES`) inside 07:00-21:00 (`VISIBLE_HOUR_START`/`VISIBLE_HOUR_END`); events with `transparency === "free"` do not split a gap.
- **Git:** use `/usr/bin/git` for add/commit (the rtk hook returns canned "ok" for `git commit` without committing). Work on the current worktree branch.
- **Tests:** run targeted files: `./node_modules/.bin/vitest run src/__tests__/unit/<file> --exclude '**/.worktrees/**'`. Do not run the full suite with local Redis up (integration tests 429 against the real rate limiter).
- Existing pure helpers to reuse (do not reimplement): `freetimeMinutes`, `allDayEventsOnDay`, `timedEventsOnDay`, `civilKey`, `compareCivil` from `src/components/calendar/grid-model.ts`; `addDays`, `civilFromZoned`, `formatDateParam`, `formatTimeLabel`, `isWeekend`, `sameCivil`, `minutesFromDayStart`, `rangeUtc`, `zonedWallToUtc`, `parseDateParam` from `src/lib/calendar/view-time.ts`.
- Deviation from spec noted and accepted: `filmstrip-model.ts` lives in `src/components/calendar/` (next to `grid-model.ts`, which it reuses), not `src/lib/calendar/`.

---

### Task 1: Duration + freetime label helpers

**Files:**
- Modify: `src/lib/calendar/view-time.ts` (append at end)
- Test: `src/__tests__/unit/calendar-view-time.test.ts` (append a describe block)

**Interfaces:**
- Produces: `formatDurationLabel(minutes: number): string` and `formatFreetimeLabel(minutes: number): string`, used by Tasks 2, 4, 7.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/unit/calendar-view-time.test.ts`:

```ts
import {
  formatDurationLabel,
  formatFreetimeLabel,
} from "@/lib/calendar/view-time";

describe("formatDurationLabel", () => {
  it("formats sub-hour durations in minutes", () => {
    expect(formatDurationLabel(45)).toBe("45 min");
  });
  it("formats whole hours", () => {
    expect(formatDurationLabel(60)).toBe("1 h");
    expect(formatDurationLabel(180)).toBe("3 h");
  });
  it("formats half hours with a decimal", () => {
    expect(formatDurationLabel(90)).toBe("1.5 h");
  });
  it("formats other remainders as h + min", () => {
    expect(formatDurationLabel(135)).toBe("2 h 15 min");
  });
});

describe("formatFreetimeLabel", () => {
  it("appends free", () => {
    expect(formatFreetimeLabel(180)).toBe("3 h free");
    expect(formatFreetimeLabel(150)).toBe("2.5 h free");
  });
});
```

(Adjust the import to merge with the file's existing import from `@/lib/calendar/view-time`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-view-time.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `formatDurationLabel` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/calendar/view-time.ts`:

```ts
export function formatDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} h`;
  if (rem === 30) return `${hours}.5 h`;
  return `${hours} h ${rem} min`;
}

export function formatFreetimeLabel(minutes: number): string {
  return `${formatDurationLabel(minutes)} free`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/calendar/view-time.ts src/__tests__/unit/calendar-view-time.test.ts
/usr/bin/git commit -m "feat(calendar): add duration and freetime label helpers"
```

---

### Task 2: FreetimeBlock component + week-grid freetime replacement

Replaces the floating centered `Free` word (currently `time-grid.tsx` ~line 457-468: a `pointer-events-none` div with `flex items-center` and a bare `Free` span).

**Files:**
- Create: `src/components/calendar/freetime-block.tsx`
- Modify: `src/components/calendar/time-grid.tsx` (the `gaps.map(...)` block inside the day column render)

**Interfaces:**
- Consumes: `formatFreetimeLabel` (Task 1), `freetimeMinutes` + `pxFromMinutes` (existing, already used at the call site).
- Produces: `FreetimeBlock({ minutes, onSelect, className, style })` — reused by Task 7's filmstrip.

- [ ] **Step 1: Create the component**

`src/components/calendar/freetime-block.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { formatFreetimeLabel } from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

/**
 * A bounded freetime span. The wash + hairlines are visual only and let
 * pointer events through (week-grid drag-create must keep working across
 * a gap); the label is the click target that claims the whole span.
 */
export function FreetimeBlock({
  minutes,
  onSelect,
  className,
  style,
}: {
  minutes: number;
  onSelect?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none border-y border-border/70",
        className,
      )}
      style={{
        background: "color-mix(in srgb, var(--primary) 6%, transparent)",
        ...style,
      }}
    >
      {onSelect ? (
        <button
          type="button"
          className="pointer-events-auto m-1 rounded-xs px-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {formatFreetimeLabel(minutes)}
        </button>
      ) : (
        <span className="m-1 inline-block px-0.5 text-xs tabular-nums text-muted-foreground">
          {formatFreetimeLabel(minutes)}
        </span>
      )}
    </div>
  );
}
```

Notes for the implementer:
- `onPointerDown` stopPropagation on the *button only* prevents the column's drag-create from starting when the user clicks the label; the rest of the block still lets drags through (that is why the wrapper is `pointer-events-none` and the button re-enables itself).
- The label sits top-left by normal flow — never vertically centered.

- [ ] **Step 2: Replace the week-grid gap rendering**

In `src/components/calendar/time-grid.tsx`, replace the `gaps.map(...)` block:

```tsx
{gaps.map((gap) => (
  <FreetimeBlock
    key={`${gap.startMin}-${gap.endMin}`}
    minutes={gap.endMin - gap.startMin}
    className="absolute inset-x-0"
    style={{
      top: pxFromMinutes(gap.startMin),
      height: pxFromMinutes(gap.endMin - gap.startMin),
    }}
    onSelect={
      canCreate
        ? () =>
            onSelectSlot({
              date: formatDateParam(day),
              startMin: gap.startMin,
              endMin: gap.endMin,
              allDay: false,
            })
        : undefined
    }
  />
))}
```

Add the import: `import { FreetimeBlock } from "@/components/calendar/freetime-block";` and remove nothing else — `freetimeMinutes` and `pxFromMinutes` stay.

- [ ] **Step 3: Verify by running existing tests + lint**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-view-time.test.ts src/__tests__/unit/calendar-timed-drag.test.ts --exclude '**/.worktrees/**'`
Expected: PASS.
Run: `./node_modules/.bin/eslint src/components/calendar/freetime-block.tsx src/components/calendar/time-grid.tsx`
Expected: clean.

- [ ] **Step 4: Visual spot-check**

With the dev server running (`./node_modules/.bin/next dev --turbopack -p 3002`, demo login alex@kurir.io / kurir-demo), use agent-browser to screenshot `/calendar?stay=1`. Expected: today's 10:00-13:00 gap shows a washed block with hairlines and a top-left "3 h free" label; clicking the label opens the event dialog prefilled 10:00-13:00; drag-create still works when starting inside the block away from the label.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/calendar/freetime-block.tsx src/components/calendar/time-grid.tsx
/usr/bin/git commit -m "feat(calendar): bounded clickable freetime blocks in the week grid"
```

---

### Task 3: Personality pass (week grid + month + event chrome)

**Files:**
- Modify: `src/lib/calendar/color.ts` (fill strength)
- Modify: `src/components/calendar/event-block.tsx` (semibold title)
- Modify: `src/components/calendar/time-grid.tsx` (today wash, header numeral, time labels in blocks, now-line dot)
- Modify: `src/components/calendar/month-view.tsx` (today cell wash)
- Test: `src/__tests__/unit/calendar-color.test.ts` (update fill expectation)

**Interfaces:**
- Consumes: `formatTimeLabel` (existing), `PlacedTimed` rows in `time-grid.tsx`.
- Produces: nothing new — visual changes only.

- [ ] **Step 1: Update the color test first**

In `src/__tests__/unit/calendar-color.test.ts`, find the assertion on `--event-fill` (it expects `18%`) and change the expected mix to `24%`.

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-color.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL (still 18%).

- [ ] **Step 3: Strengthen the fill + title**

In `src/lib/calendar/color.ts`, change the fill line to:

```ts
"--event-fill":
  "color-mix(in srgb, var(--event-color) 24%, var(--background))",
```

In `src/components/calendar/event-block.tsx`, change the title span class `text-xs font-medium` to `text-xs font-semibold`.

- [ ] **Step 4: Run to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Time labels inside timed blocks (>= 45 min)**

In `src/components/calendar/time-grid.tsx`, in the `placed.map((row) => ...)` render, pass a `timeLabel` to `EventBlock` (the prop already exists and renders as a prefix):

```tsx
timeLabel={
  row.endMin - row.startMin >= 45
    ? formatTimeLabel(Math.floor(row.startMin / 60), row.startMin % 60)
    : undefined
}
```

- [ ] **Step 6: Celebrate today (week grid)**

In `time-grid.tsx`:

- Day header cells (`showDayHeader` block): add a today wash and keep the numeral accent —

```tsx
className={cn(
  "min-w-0 flex-1 py-2 text-center",
  isWeekend(day) && "bg-muted/40",
  sameCivil(day, today) && "bg-primary/5",
)}
```

- All-day cells and day columns: add `sameCivil(day, today) && "bg-primary/5"` to their existing `cn(...)` calls the same way (the column already computes `day`; `today` is in scope).

- [ ] **Step 7: Now-line dot**

In the now-line render in `time-grid.tsx`, inside the existing `h-px bg-primary` div, add a dot before the time label span:

```tsx
<span
  aria-hidden
  className="absolute -left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary"
/>
```

- [ ] **Step 8: Month today cell**

In `src/components/calendar/month-view.tsx` (~line 223), the today numeral already gets `font-semibold text-primary`. Find the day-cell wrapper `cn(...)` in the same component and add `sameCivil(day, today) && "bg-primary/5"` to it.

- [ ] **Step 9: Lint + visual spot-check**

Run: `./node_modules/.bin/eslint src/components/calendar/ src/lib/calendar/color.ts`
Expected: clean.
Screenshot `/calendar?stay=1` and `/calendar/month`: today's column/cell carries a warm wash, events read stronger with start times, the now-line has a dot.

- [ ] **Step 10: Commit**

```bash
/usr/bin/git add src/lib/calendar/color.ts src/components/calendar/event-block.tsx src/components/calendar/time-grid.tsx src/components/calendar/month-view.tsx src/__tests__/unit/calendar-color.test.ts
/usr/bin/git commit -m "feat(calendar): personality pass - today wash, stronger event chrome, now dot"
```

---

### Task 4: Filmstrip layout model

**Files:**
- Create: `src/components/calendar/filmstrip-model.ts`
- Test: `src/__tests__/unit/calendar-filmstrip-model.test.ts`

**Interfaces:**
- Consumes: `freetimeMinutes`, `allDayEventsOnDay`, `timedEventsOnDay`, `civilKey` from `@/components/calendar/grid-model`; `minutesFromDayStart`, `civilFromZoned`, `sameCivil`, `isWeekend`, `compareCivil` (from grid-model), `formatTimeLabel`, `formatDurationLabel`, `formatFreetimeLabel`, `nowMinutesOnDay` (grid-model), `CalendarInstanceDTO`.
- Produces (Task 7 renders exactly these):

```ts
export type FilmstripItem =
  | {
      kind: "event";
      instance: CalendarInstanceDTO;
      startMin: number;
      endMin: number;
      heightPx: number;
      startLabel: string;     // "09:00"
      durationLabel: string;  // "1 h"
    }
  | {
      kind: "freetime";
      startMin: number;
      endMin: number;
      heightPx: number;
      minutes: number;        // endMin - startMin, for FreetimeBlock
    }
  | { kind: "seam" };

export type NowMarker =
  | { kind: "in-item"; index: number; fraction: number } // 0..1 within items[index]
  | { kind: "between"; beforeIndex: number };            // render before items[beforeIndex]

export type FilmstripDay = {
  date: CivilDate;
  key: string;                // "YYYY-MM-DD"
  isToday: boolean;
  isWeekend: boolean;
  isPast: boolean;            // civil day strictly before today
  allDay: CalendarInstanceDTO[];
  items: FilmstripItem[];     // ordered by startMin, seam always last
  now: NowMarker | null;      // only set when isToday
  nowTimeLabel: string | null; // "13:37" when now is set, else null
};

export function entryHeightPx(minutes: number): number;
export function buildFilmstrip(
  instances: CalendarInstanceDTO[],
  days: CivilDate[],
  timezone: string,
  now: Date,
): FilmstripDay[];
```

Behavior rules:
- `entryHeightPx(minutes) = Math.round(Math.min(140, Math.max(40, 24 + minutes * 0.5)))` — 1 h → 54 px, 3 h → 114 px, >= 232 min clamps to 140.
- Timed events: from `timedEventsOnDay`, `startMin`/`endMin` via `minutesFromDayStart` (day-clamped: an event crossing midnight contributes its within-day part, matching the grid), sorted by `startMin` then `endMin`; overlaps simply render sequentially (no columns).
- Freetime items: straight from `freetimeMinutes` (threshold + transparency rules already inside it).
- Events and freetime are merged into one list sorted by `startMin` (ties: freetime after events).
- Exactly one `seam` appended at the end of every day's items (the collapsed night).
- `now`: only on today. `nowMin = nowMinutesOnDay(day, timezone, now)`; the first non-seam item with `startMin <= nowMin < endMin` gives `{kind:"in-item", index, fraction:(nowMin-startMin)/(endMin-startMin)}`; otherwise `{kind:"between", beforeIndex}` where `beforeIndex` is the index of the first item with `startMin > nowMin` (or `items.length - 1`, i.e. before the seam, when no such item exists).
- `isPast`: `compareCivil(day, civilFromZoned(now, timezone)) < 0`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/unit/calendar-filmstrip-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildFilmstrip,
  entryHeightPx,
} from "@/components/calendar/filmstrip-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

const TZ = "Europe/Stockholm";

function inst(over: Partial<CalendarInstanceDTO>): CalendarInstanceDTO {
  return {
    eventId: "e1",
    title: "Event",
    startAt: "2026-08-21T07:00:00.000Z", // 09:00 Stockholm (CEST)
    endAt: "2026-08-21T08:00:00.000Z",
    isAllDay: false,
    isException: false,
    calendarId: "c1",
    color: "#b45309",
    calendarName: "Personal",
    transparency: "busy",
    location: null,
    description: null,
    rrule: null,
    isReadOnly: false,
    ...over,
  };
}

const FRI: { year: number; month: number; day: number } = {
  year: 2026,
  month: 8,
  day: 21,
};
const NOON = new Date("2026-08-21T10:00:00.000Z"); // 12:00 Stockholm

describe("entryHeightPx", () => {
  it("scales with duration and clamps", () => {
    expect(entryHeightPx(60)).toBe(54);
    expect(entryHeightPx(180)).toBe(114);
    expect(entryHeightPx(15)).toBe(40);
    expect(entryHeightPx(600)).toBe(140);
  });
});

describe("buildFilmstrip", () => {
  it("orders events and freetime by start, seam last", () => {
    const days = buildFilmstrip(
      [
        inst({}), // 09:00-10:00
        inst({
          eventId: "e2",
          title: "Deep work",
          startAt: "2026-08-21T11:00:00.000Z", // 13:00
          endAt: "2026-08-21T12:00:00.000Z",
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    const kinds = days[0].items.map((i) => i.kind);
    // freetime 07-09 (120 min), event 09-10, freetime 10-13, event 13-14,
    // freetime 14-21 (420 min), seam
    expect(kinds).toEqual([
      "freetime",
      "event",
      "freetime",
      "event",
      "freetime",
      "seam",
    ]);
    const first = days[0].items[1];
    expect(first.kind).toBe("event");
    if (first.kind === "event") {
      expect(first.startLabel).toBe("09:00");
      expect(first.durationLabel).toBe("1 h");
    }
  });

  it("places the now marker inside the containing item", () => {
    const days = buildFilmstrip([inst({})], [FRI], TZ, NOON);
    // 12:00 falls in the 10:00-21:00... actually in the 10-21 freetime gap
    expect(days[0].isToday).toBe(true);
    expect(days[0].now).not.toBeNull();
    expect(days[0].nowTimeLabel).toBe("12:00");
    if (days[0].now?.kind === "in-item") {
      const item = days[0].items[days[0].now.index];
      expect(item.kind).toBe("freetime");
      expect(days[0].now.fraction).toBeGreaterThan(0);
      expect(days[0].now.fraction).toBeLessThan(1);
    } else {
      throw new Error("expected in-item now marker");
    }
  });

  it("marks past days and gives them no now marker", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 20 }, FRI], TZ, NOON);
    expect(days[0].isPast).toBe(true);
    expect(days[0].now).toBeNull();
    expect(days[1].isPast).toBe(false);
  });

  it("separates all-day events from the flow", () => {
    const days = buildFilmstrip(
      [
        inst({
          eventId: "hol",
          isAllDay: true,
          startAt: "2026-08-21T00:00:00.000Z",
          endAt: "2026-08-22T00:00:00.000Z",
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    expect(days[0].allDay).toHaveLength(1);
    // whole visible day is one freetime span + seam
    expect(days[0].items.map((i) => i.kind)).toEqual(["freetime", "seam"]);
  });

  it("an empty day has only a seam", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 22 }], TZ, NOON);
    expect(days[0].items.map((i) => i.kind)).toEqual(["freetime", "seam"]);
  });

  it("handles the DST fall-back day without negative spans", () => {
    // Europe/Stockholm 2026-10-25 is 25 h long
    const dst = { year: 2026, month: 10, day: 25 };
    const days = buildFilmstrip([], [dst], TZ, NOON);
    for (const item of days[0].items) {
      if (item.kind !== "seam") {
        expect(item.endMin).toBeGreaterThan(item.startMin);
        expect(item.heightPx).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
```

Note: an "empty" day still yields one freetime item (07:00-21:00 is a >= 2 h gap). The component (Task 7) renders "Nothing planned" when a day has no *event* items; the model does not special-case it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-filmstrip-model.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `filmstrip-model.ts`**

```ts
import {
  allDayEventsOnDay,
  civilKey,
  compareCivil,
  freetimeMinutes,
  nowMinutesOnDay,
  timedEventsOnDay,
} from "@/components/calendar/grid-model";
import {
  civilFromZoned,
  formatDurationLabel,
  formatTimeLabel,
  isWeekend,
  minutesFromDayStart,
  sameCivil,
  type CivilDate,
} from "@/lib/calendar/view-time";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

export type FilmstripItem = /* as in Interfaces above */;
export type NowMarker = /* as in Interfaces above */;
export type FilmstripDay = /* as in Interfaces above */;

export function entryHeightPx(minutes: number): number {
  return Math.round(Math.min(140, Math.max(40, 24 + minutes * 0.5)));
}

function nowMarker(
  items: FilmstripItem[],
  nowMin: number | null,
): NowMarker | null {
  if (nowMin == null) return null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "seam") continue;
    if (item.startMin <= nowMin && nowMin < item.endMin) {
      return {
        kind: "in-item",
        index: i,
        fraction: (nowMin - item.startMin) / (item.endMin - item.startMin),
      };
    }
  }
  const before = items.findIndex(
    (item) => item.kind !== "seam" && item.startMin > nowMin,
  );
  return {
    kind: "between",
    beforeIndex: before === -1 ? items.length - 1 : before,
  };
}

export function buildFilmstrip(
  instances: CalendarInstanceDTO[],
  days: CivilDate[],
  timezone: string,
  now: Date,
): FilmstripDay[] {
  const today = civilFromZoned(now, timezone);
  return days.map((day) => {
    const timed = timedEventsOnDay(instances, day, timezone)
      .map((instance) => {
        const startMin = minutesFromDayStart(
          new Date(instance.startAt),
          day,
          timezone,
        );
        const endMin = Math.max(
          minutesFromDayStart(new Date(instance.endAt), day, timezone),
          startMin + 15,
        );
        return {
          kind: "event" as const,
          instance,
          startMin,
          endMin,
          heightPx: entryHeightPx(endMin - startMin),
          startLabel: formatTimeLabel(
            Math.floor(startMin / 60),
            startMin % 60,
          ),
          durationLabel: formatDurationLabel(endMin - startMin),
        };
      });
    const free = freetimeMinutes(instances, day, timezone).map((gap) => ({
      kind: "freetime" as const,
      startMin: gap.startMin,
      endMin: gap.endMin,
      heightPx: entryHeightPx(gap.endMin - gap.startMin),
      minutes: gap.endMin - gap.startMin,
    }));
    const items: FilmstripItem[] = [...timed, ...free].sort(
      (a, b) =>
        a.startMin - b.startMin ||
        (a.kind === "freetime" ? 1 : 0) - (b.kind === "freetime" ? 1 : 0),
    );
    items.push({ kind: "seam" });
    const isToday = sameCivil(day, today);
    const nowMin = isToday ? nowMinutesOnDay(day, timezone, now) : null;
    return {
      date: day,
      key: civilKey(day),
      isToday,
      isWeekend: isWeekend(day),
      isPast: compareCivil(day, today) < 0,
      allDay: allDayEventsOnDay(instances, day, timezone),
      items,
      now: nowMarker(items, nowMin),
      nowTimeLabel:
        nowMin == null
          ? null
          : formatTimeLabel(Math.floor(nowMin / 60), Math.floor(nowMin % 60)),
    };
  });
}
```

(Write the three type definitions out in full — they are specified verbatim in the Interfaces block above.)

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS. If the "orders events" test's expected kind sequence differs (e.g. 14:00-21:00 gap missing), debug against `freetimeSpans` behavior rather than editing expectations blindly — a 14:00-21:00 empty span is 420 min >= 120 and must appear.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/components/calendar/filmstrip-model.ts src/__tests__/unit/calendar-filmstrip-model.test.ts
/usr/bin/git commit -m "feat(calendar): filmstrip layout model"
```

---

### Task 5: Instances API route

**Files:**
- Create: `src/lib/calendar/instances-route.ts` (pure helper, repo convention: route logic lives in a testable lib file)
- Create: `src/app/api/calendar/instances/route.ts`
- Modify: `src/lib/calendar/page-data.ts` (export `serializeInstance`)
- Test: `src/__tests__/unit/calendar-instances-route.test.ts`

**Interfaces:**
- Consumes: `parseDateParam`-style civil parsing (write locally, `parseDateParam` falls back to today which is wrong here), `addDays`, `compareCivil` semantics.
- Produces:
  - `parseInstancesRange(start: string | null, end: string | null): { start: CivilDate; endExclusive: CivilDate } | null` — null on invalid; clamps the span to max 31 days.
  - `GET /api/calendar/instances?start=YYYY-MM-DD&end=YYYY-MM-DD` → `{ instances: CalendarInstanceDTO[] }` (end exclusive), 401 unauthenticated, 400 invalid.
  - `serializeInstance` exported from `page-data.ts` (unchanged behavior).

- [ ] **Step 1: Write the failing tests**

`src/__tests__/unit/calendar-instances-route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseInstancesRange } from "@/lib/calendar/instances-route";

describe("parseInstancesRange", () => {
  it("parses a valid range", () => {
    const parsed = parseInstancesRange("2026-08-18", "2026-08-25");
    expect(parsed).toEqual({
      start: { year: 2026, month: 8, day: 18 },
      endExclusive: { year: 2026, month: 8, day: 25 },
    });
  });

  it("rejects missing or malformed params", () => {
    expect(parseInstancesRange(null, "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-18", null)).toBeNull();
    expect(parseInstancesRange("18-08-2026", "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-18", "not-a-date")).toBeNull();
  });

  it("rejects end <= start", () => {
    expect(parseInstancesRange("2026-08-25", "2026-08-25")).toBeNull();
    expect(parseInstancesRange("2026-08-25", "2026-08-18")).toBeNull();
  });

  it("clamps spans longer than 31 days", () => {
    const parsed = parseInstancesRange("2026-08-01", "2026-12-01");
    expect(parsed?.endExclusive).toEqual({ year: 2026, month: 9, day: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-instances-route.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

`src/lib/calendar/instances-route.ts`:

```ts
import { addDays, type CivilDate } from "@/lib/calendar/view-time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

function parseCivil(value: string | null): CivilDate | null {
  if (!value || !DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
}

export function parseInstancesRange(
  start: string | null,
  end: string | null,
): { start: CivilDate; endExclusive: CivilDate } | null {
  const from = parseCivil(start);
  const to = parseCivil(end);
  if (!from || !to) return null;
  const span = daysBetween(from, to);
  if (span <= 0) return null;
  return {
    start: from,
    endExclusive: span > MAX_DAYS ? addDays(from, MAX_DAYS) : to,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Export `serializeInstance` and write the route**

In `src/lib/calendar/page-data.ts`, change `function serializeInstance` to `export function serializeInstance`.

`src/app/api/calendar/instances/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import { parseInstancesRange } from "@/lib/calendar/instances-route";
import { serializeInstance } from "@/lib/calendar/page-data";
import { rangeUtc } from "@/lib/calendar/view-time";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = parseInstancesRange(params.get("start"), params.get("end"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { timezone: true },
  });
  const timezone = user?.timezone || "UTC";
  const { from, to } = rangeUtc(parsed.start, parsed.endExclusive, timezone);
  const instances = await listVisibleInstancesForUser(
    session.user.id,
    from,
    to,
  );

  return NextResponse.json({ instances: instances.map(serializeInstance) });
}
```

- [ ] **Step 6: Lint + manual probe**

Run: `./node_modules/.bin/eslint src/lib/calendar/instances-route.ts src/app/api/calendar/instances/route.ts src/lib/calendar/page-data.ts`
Expected: clean.
With the dev server up and a logged-in agent-browser session, fetch `http://localhost:3002/api/calendar/instances?start=2026-08-18&end=2026-08-25` (e.g. via the browser). Expected: JSON with the seeded events. Unauthenticated curl gets 401.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/lib/calendar/instances-route.ts src/app/api/calendar/instances/route.ts src/lib/calendar/page-data.ts src/__tests__/unit/calendar-instances-route.test.ts
/usr/bin/git commit -m "feat(calendar): instances range API for filmstrip windowing"
```

---

### Task 6: Day-mode window + static Filmstrip component

The filmstrip rendering, wired into the shell, without infinite scroll yet (Task 7 adds windowing). Deliverable: `/calendar/day` shows a static 15-day strip.

**Files:**
- Modify: `src/lib/calendar/page-data.ts` (day mode loads anchor-3 .. anchor+12)
- Create: `src/components/calendar/filmstrip.tsx`
- Modify: `src/components/calendar/day-view.tsx` (render Filmstrip)
- Modify: `src/components/calendar/calendar-shell.tsx` (day title follows the visible day; pass `onVisibleDayChange`)

**Interfaces:**
- Consumes: `buildFilmstrip`, `FilmstripDay`, `FilmstripItem`, `NowMarker`, `entryHeightPx` (Task 4); `FreetimeBlock` (Task 2); `eventBlockStyle` from `@/lib/calendar/color`; `formatDayTitle`, `formatDateParam`, `addDays`, `parseDateParam`; `SlotSelection`, `CalendarInstanceDTO`.
- Produces:

```tsx
export function Filmstrip(props: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[]; // server window
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
}): JSX.Element
```

- [ ] **Step 1: Widen the day-mode window**

In `src/lib/calendar/page-data.ts`, import `addDays` and `rangeUtc` from view-time, and change the day branch of `range`:

```ts
mode === "week"
  ? weekRangeUtc(anchor, timezone)
  : mode === "month"
    ? monthRangeUtc(anchor, timezone)
    : rangeUtc(addDays(anchor, -3), addDays(anchor, 12), timezone);
```

(`dayRangeUtc` import becomes unused — remove it.)

- [ ] **Step 2: Create `src/components/calendar/filmstrip.tsx`**

Static version — render only, plus the 30 s now-tick:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { FreetimeBlock } from "@/components/calendar/freetime-block";
import { EventBlock } from "@/components/calendar/event-block";
import {
  buildFilmstrip,
  type FilmstripDay,
  type FilmstripItem,
} from "@/components/calendar/filmstrip-model";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { eventBlockStyle } from "@/lib/calendar/color";
import {
  addDays,
  formatDateParam,
  formatWeekdayShort,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const WINDOW_BACK = 3;
const WINDOW_FORWARD = 12; // exclusive end offset

function daySpan(start: CivilDate, endExclusive: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  let cursor = start;
  while (formatDateParam(cursor) !== formatDateParam(endExclusive)) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function NowLine({ label }: { label: string }) {
  return (
    <div aria-hidden className="relative z-10 h-px bg-primary">
      <span className="absolute -left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      <span className="absolute -top-2 left-2 text-[10px] tabular-nums text-primary">
        {label}
      </span>
    </div>
  );
}

export function Filmstrip({
  anchor,
  instances,
  timezone,
  canCreate,
  onSelectSlot,
  onEventClick,
  onVisibleDayChange,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const days = useMemo(
    () =>
      daySpan(addDays(anchor, -WINDOW_BACK), addDays(anchor, WINDOW_FORWARD)),
    [anchor],
  );
  const model = useMemo(
    () => buildFilmstrip(instances, days, timezone, now),
    [instances, days, timezone, now],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        {model.map((day) => (
          <FilmstripDaySection
            key={day.key}
            day={day}
            canCreate={canCreate}
            onSelectSlot={onSelectSlot}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}
```

`FilmstripDaySection` (same file):

```tsx
function FilmstripDaySection({
  day,
  canCreate,
  onSelectSlot,
  onEventClick,
}: {
  day: FilmstripDay;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const hasEvents =
    day.allDay.length > 0 || day.items.some((i) => i.kind === "event");

  function renderItem(item: FilmstripItem, index: number) {
    const between =
      day.now?.kind === "between" && day.now.beforeIndex === index;
    const inside = day.now?.kind === "in-item" && day.now.index === index;
    return (
      <div key={index} className="relative">
        {between && <NowLine label={day.nowTimeLabel ?? ""} />}
        {item.kind === "event" && (
          <button
            type="button"
            onClick={() => onEventClick(item.instance)}
            className="flex w-full items-baseline gap-3 rounded-xs px-3 py-2 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            style={{
              minHeight: item.heightPx,
              ...eventBlockStyle(item.instance.color),
              borderLeft: "2px solid var(--event-color)",
              backgroundColor: "var(--event-fill)",
            }}
          >
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {item.startLabel}
            </span>
            <span className="min-w-0 truncate text-sm font-semibold">
              {item.instance.title}
            </span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {item.durationLabel}
            </span>
          </button>
        )}
        {item.kind === "freetime" && (
          <FreetimeBlock
            minutes={item.minutes}
            className="flex flex-col"
            style={{ height: item.heightPx }}
            onSelect={
              canCreate
                ? () =>
                    onSelectSlot({
                      date: day.key,
                      startMin: item.startMin,
                      endMin: item.endMin,
                      allDay: false,
                    })
                : undefined
            }
          />
        )}
        {item.kind === "seam" && (
          <div aria-hidden className="my-3 border-t border-dashed border-border" />
        )}
        {inside && item.kind !== "seam" && (
          <div
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: `${(day.now as { fraction: number }).fraction * 100}%`,
            }}
          >
            <NowLine label={day.nowTimeLabel ?? ""} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      data-filmstrip-day={day.key}
      className={cn("pt-6", day.isPast && "opacity-60")}
    >
      <header className="flex items-baseline gap-2 pb-2">
        <span
          className={cn(
            "font-serif text-2xl font-semibold tabular-nums",
            day.isToday && "text-primary",
          )}
        >
          {day.date.day}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {formatWeekdayShort(day.date)}
        </span>
      </header>
      {day.allDay.map((row) => (
        <EventBlock
          key={`${row.eventId}:${row.startAt}`}
          title={row.title}
          color={row.color}
          muted={row.transparency === "free"}
          className="relative mb-1 h-5"
          onClick={() => onEventClick(row)}
        />
      ))}
      {hasEvents ? (
        day.items.map(renderItem)
      ) : (
        <button
          type="button"
          disabled={!canCreate}
          onClick={() =>
            onSelectSlot({
              date: day.key,
              startMin: 9 * 60,
              endMin: 10 * 60,
              allDay: false,
            })
          }
          className="w-full rounded-xs px-3 py-4 text-left text-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none"
        >
          Nothing planned
        </button>
      )}
      {!hasEvents && (
        <div aria-hidden className="my-3 border-t border-dashed border-border" />
      )}
    </section>
  );
}
```

Implementer notes:
- When a day has no events, render the "Nothing planned" button INSTEAD of the items list (the freetime item would duplicate it), then a seam. Dense/empty day heights follow automatically.
- `onVisibleDayChange` becomes functional in Task 7. In this task, declare it in the props *type* but do not destructure it yet (avoids an unused-variable lint error); Task 7 destructures and wires it.
- Weekend styling: add `day.isWeekend && "bg-muted/20"` to the section class if it reads well in the spot-check; skip if noisy.

- [ ] **Step 3: Rewrite `day-view.tsx`**

```tsx
"use client";

import { Filmstrip } from "@/components/calendar/filmstrip";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import type { CivilDate } from "@/lib/calendar/view-time";

export function DayView({
  anchor,
  instances,
  timezone,
  canCreate,
  onSelectSlot,
  onEventClick,
  onVisibleDayChange,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
}) {
  return (
    <Filmstrip
      anchor={anchor}
      instances={instances}
      timezone={timezone}
      canCreate={canCreate}
      onSelectSlot={onSelectSlot}
      onEventClick={onEventClick}
      onVisibleDayChange={onVisibleDayChange}
    />
  );
}
```

(`onTimedCommit` is no longer a DayView prop; the shell's `viewProps` spread includes it — either drop the spread for DayView and pass explicit props, or keep the spread and let DayView ignore extras. Prefer explicit props in the shell:)

- [ ] **Step 4: Shell wiring — title follows the visible day**

In `src/components/calendar/calendar-shell.tsx`:

1. Add state + effect near the other state hooks:

```tsx
const [visibleDay, setVisibleDay] = useState<CivilDate>(payload.anchor);
useEffect(() => {
  setVisibleDay(payload.anchor);
}, [payload.anchor]);
```

2. Title: in the `title` memo, day mode uses `visibleDay`:

```tsx
if (payload.mode === "day") return formatDayTitle(visibleDay);
```

(add `visibleDay` to the memo deps).

3. `date` (used by viewHref links and defaultSlot): make it follow the visible day in day mode:

```tsx
const date = formatDateParam(
  payload.mode === "day" ? visibleDay : payload.anchor,
);
```

(`date` moves below the state declaration.)

4. Replace `<DayView {...viewProps} />` with:

```tsx
<DayView
  anchor={payload.anchor}
  instances={payload.instances}
  timezone={payload.timezone}
  canCreate={writable}
  onSelectSlot={openCreate}
  onEventClick={openEvent}
  onVisibleDayChange={setVisibleDay}
/>
```

- [ ] **Step 5: Verify**

Run: `./node_modules/.bin/vitest run src/__tests__/unit/calendar-filmstrip-model.test.ts src/__tests__/unit/calendar-view-time.test.ts --exclude '**/.worktrees/**'` — PASS.
Run: `./node_modules/.bin/eslint src/components/calendar/ src/lib/calendar/page-data.ts` — clean.
Visual: `/calendar/day` shows a 15-day strip: headers with serif numerals, today terracotta, the seeded Standup/Deep work entries with time + duration, a "3 h free" block between them, past days faded, seams between days, "Nothing planned" on empty days, now-line creeping in today. Creating from a freetime block and tapping events opens the dialog.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/components/calendar/filmstrip.tsx src/components/calendar/filmstrip-model.ts src/__tests__/unit/calendar-filmstrip-model.test.ts src/components/calendar/day-view.tsx src/components/calendar/calendar-shell.tsx src/lib/calendar/page-data.ts
/usr/bin/git commit -m "feat(calendar): filmstrip day view (static window)"
```

---

### Task 7: Infinite scroll, URL sync, initial scroll

**Files:**
- Modify: `src/components/calendar/filmstrip.tsx`

**Interfaces:**
- Consumes: `GET /api/calendar/instances?start&end` (Task 5) returning `{ instances: CalendarInstanceDTO[] }`.
- Produces: no interface changes — behavior only.

- [ ] **Step 1: Add windowed state + fetching to `Filmstrip`**

Replace the `days` memo with stateful range and instance store:

```tsx
const [range, setRange] = useState(() => ({
  start: addDays(anchor, -WINDOW_BACK),
  endExclusive: addDays(anchor, WINDOW_FORWARD),
}));
const [byKey, setByKey] = useState<Map<string, CalendarInstanceDTO>>(
  () => new Map(instances.map((i) => [`${i.eventId}:${i.startAt}`, i])),
);
const [loadError, setLoadError] = useState<"past" | "future" | null>(null);
const loadingRef = useRef<{ past: boolean; future: boolean }>({
  past: false,
  future: false,
});
```

Server refresh reconciliation (create/edit/delete triggers `router.refresh()` and new `instances`/`anchor` props): when the `instances` prop changes, drop stored entries that overlap the server window `[anchor-3, anchor+12)` and re-add the fresh ones:

```tsx
useEffect(() => {
  setByKey((prev) => {
    const next = new Map(prev);
    const winFrom = zonedWallToUtc(timezone, {
      ...addDays(anchor, -WINDOW_BACK),
      hour: 0,
      minute: 0,
    });
    const winTo = zonedWallToUtc(timezone, {
      ...addDays(anchor, WINDOW_FORWARD),
      hour: 0,
      minute: 0,
    });
    for (const [key, row] of next) {
      if (new Date(row.startAt) < winTo && new Date(row.endAt) > winFrom) {
        next.delete(key);
      }
    }
    for (const row of instances) {
      next.set(`${row.eventId}:${row.startAt}`, row);
    }
    return next;
  });
}, [instances, anchor, timezone]);
```

Fetch function:

```tsx
const extend = useCallback(
  async (direction: "past" | "future") => {
    if (loadingRef.current[direction]) return;
    loadingRef.current[direction] = true;
    setLoadError((prev) => (prev === direction ? null : prev));
    const fetchStart =
      direction === "past" ? addDays(range.start, -7) : range.endExclusive;
    const fetchEnd =
      direction === "past" ? range.start : addDays(range.endExclusive, 7);
    try {
      const res = await fetch(
        `/api/calendar/instances?start=${formatDateParam(fetchStart)}&end=${formatDateParam(fetchEnd)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { instances: CalendarInstanceDTO[] };
      setByKey((prev) => {
        const next = new Map(prev);
        for (const row of data.instances) {
          next.set(`${row.eventId}:${row.startAt}`, row);
        }
        return next;
      });
      setRange((prev) =>
        direction === "past"
          ? { ...prev, start: fetchStart }
          : { ...prev, endExclusive: fetchEnd },
      );
    } catch {
      setLoadError(direction);
    } finally {
      loadingRef.current[direction] = false;
    }
  },
  [range],
);
```

`days` memo becomes `daySpan(range.start, range.endExclusive)`; the model builds from `[...byKey.values()]`.

- [ ] **Step 2: Sentinels + IntersectionObserver**

Top and bottom sentinel divs inside the scroll container, observed with `rootMargin: "600px 0px"` against the scroll container as root; on intersect call `extend("past")` / `extend("future")`. Bottom sentinel content:

```tsx
<div ref={bottomRef} className="py-8 text-center">
  {loadError === "future" ? (
    <button
      type="button"
      onClick={() => extend("future")}
      className="text-sm text-muted-foreground underline-offset-2 hover:underline"
    >
      Couldn&apos;t load more days — retry
    </button>
  ) : (
    <p className="font-serif text-sm italic text-muted-foreground">
      Time never stops.
    </p>
  )}
</div>
```

Top sentinel mirrors it with `extend("past")` and the same retry copy (no tagline at the top).

- [ ] **Step 3: Prepend without viewport jump**

When `range.start` moves earlier, keep the visual position: capture the container's `scrollHeight` before the state update and correct in a layout effect:

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const prependCorrection = useRef<number | null>(null);
// in extend("past"), right before setRange:
prependCorrection.current = containerRef.current?.scrollHeight ?? null;

useLayoutEffect(() => {
  const node = containerRef.current;
  if (node == null || prependCorrection.current == null) return;
  node.scrollTop += node.scrollHeight - prependCorrection.current;
  prependCorrection.current = null;
}, [range.start]);
```

- [ ] **Step 4: Initial scroll + visible-day tracking**

Initial scroll (once, on mount): give each day section `data-filmstrip-day={day.key}`; find the anchor's section; if the anchor is today and a now-line exists, scroll the now-line element (`data-filmstrip-now` attribute on the NowLine wrapper in today's section) to `container center`; else `section.offsetTop - 8`:

```tsx
const didInitialScroll = useRef(false);
useLayoutEffect(() => {
  if (didInitialScroll.current) return;
  const node = containerRef.current;
  if (!node) return;
  const target =
    node.querySelector<HTMLElement>("[data-filmstrip-now]") ??
    node.querySelector<HTMLElement>(
      `[data-filmstrip-day="${formatDateParam(anchor)}"]`,
    );
  if (!target) return;
  node.scrollTop = Math.max(0, target.offsetTop - node.clientHeight / 3);
  didInitialScroll.current = true;
}, [anchor]);
```

Visible-day tracking (rAF-throttled scroll handler on the container): pick the last section whose `offsetTop <= scrollTop + 24`; when its key differs from the last reported one, call `window.history.replaceState(null, "", \`/calendar/day?date=${key}\`)` and `onVisibleDayChange?.(section day CivilDate)`. Keep the last-reported key in a ref to avoid redundant work. Do NOT `router.replace` (that re-renders the server component on every scroll).

- [ ] **Step 5: Verify**

Lint the file. Visual with agent-browser on `/calendar/day`:
- Scroll down several weeks: new days append after a "Time never stops." beat; URL `?date=` follows; masthead title updates.
- Scroll up into the past: days prepend with no viewport jump; past days faded.
- Reload mid-scroll: lands on the day from the URL.
- Create an event from a freetime block far in the future: dialog opens with the right date; after save the event appears (router.refresh reconciliation).
- Phone width (resize to 390px): `/calendar` redirects to the filmstrip and it reads well one-handed.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/components/calendar/filmstrip.tsx
/usr/bin/git commit -m "feat(calendar): filmstrip infinite scroll with URL sync"
```

---

### Task 8: Full verification pass

**Files:** none new.

- [ ] **Step 1: Full unit suite**

Run: `./node_modules/.bin/vitest run src/__tests__/unit --exclude '**/.worktrees/**'`
Expected: all pass. (Skip integration tests if local Redis is running — known 429 issue.)

- [ ] **Step 2: Lint everything touched**

Run: `./node_modules/.bin/eslint src/components/calendar src/lib/calendar src/app/api/calendar`
Expected: clean.

- [ ] **Step 3: Visual sweep (agent-browser, dev server on :3002)**

Screenshot and eyeball: week (freetime blocks, today wash, event chrome, now dot), day filmstrip (desktop + 390px phone width), month (today cell). Toggle dark theme (settings or `prefers-color-scheme` emulation) and re-check the filmstrip + freetime wash — `color-mix` with `--primary` must stay subtle on dark.

- [ ] **Step 4: Fix anything found, then final commit**

Any fixes discovered here get their own small commits with `/usr/bin/git`.
