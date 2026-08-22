# Calendar filmstrip + personality - design

Date: 2026-08-21
Status: approved in brainstorming, ready for implementation planning

> **Revision (2026-08-21, later):** after using the shipped vertical strip,
> the user redirected the day view to match HEY's actual filmstrip:
> **horizontal** — days as equal-width columns scrolled sideways with snap,
> story flow top-to-bottom inside each column. Timed events render as solid
> blocks of their calendar color (light/dark text by YIQ brightness), and
> today's column gets a warm wash + 2px terracotta top rail. Night seams are
> gone (each day is its own frame). Equal column widths make scroll position
> <-> day index plain arithmetic (`stripIndexAtOffset`/`stripOffsetForIndex`),
> replacing the rect-measuring scroll math that caused landing bugs. The
> sections below describe the original vertical design; data flow, freetime
> rules, interactions, and the API are unchanged.

> **Revision 2 (2026-08-22):** a side-by-side comparison with
> hey.com/calendar showed the day-card carousel still wasn't HEY's
> filmstrip — theirs is one continuous **proportional timeline**. The strip
> was rebuilt: daytime minutes (07-21) map to pixels at 1 px/min, timed
> events are full-height vertical slats (width = duration, min 32 px, text
> rotated to read bottom-to-top, lanes split the height on overlap), and
> empty night runs (21-07) collapse to fixed 36 px dark starfield bands —
> each day owns two half-nights, so adjacent days merge into one night band
> with the midnight hairline through it. Events at night stay proportional
> and break the band. Freetime keeps its click-to-create zone but reads as
> a quiet baseline duration label. `transparency=free` events render
> hatched with an italic serif title. The minute -> pixel mapping
> (`buildDaySpans`/`xForMinute`) is pure model output, so day offsets are
> prefix sums (`stripDayOffsets`) and the only DOM read is the first
> section's base offset. Day labels are sticky within the scroller; the
> now-marker is a dashed vertical through the strip with its time on the
> axis. Data flow, the instances API, and the week/month views are still
> unchanged.

## Context

The calendar shipped with HEY's information architecture (week as home,
day view, month demoted, freetime, calendar-color identity) but none of
its personality. User feedback (2026-08-21):

1. "Jag saknar typ allt fran hey.com/calendar" - the calendar looks
   like a generic hour grid, not like HEY.
2. The floating `Free` word is confusing - it renders vertically
   centered in a gap with no bounds, duration, or affordance
   (`time-grid.tsx`, `flex items-center`).
3. "Time never stops, life is like a filmstrip" is missing - HEY's day
   view is a continuous timeline telling the story of your life; ours
   is the week's hour grid rendered as one wide column.

Decisions made with the user during brainstorming:

- **True filmstrip**: the day view becomes one continuous vertical
  scroll through days (yesterday above, tomorrow below), not a
  single-day page with arrows.
- **Story flow**: entries flow and are spaced roughly by duration with
  clamps; no fixed px-per-minute scale. Empty nights collapse to a
  seam. Dense days are tall, empty days are short.
- **Week keeps the hour grid**: it is the scheduling workhorse and
  keeps all drag interactions. It gets a personality pass, not a
  rebuild.
- **Deferred to a separate spec**: day labels, habits, "sometime this
  week", event highlighting, photos/journal. Nothing in this spec
  touches the schema or the mobile API; the iOS client is unaffected.

## Goals

- Replace the day view with a HEY-style filmstrip timeline.
- Make freetime a bounded, labeled, clickable block in both the week
  grid and the filmstrip.
- Warm up week and month so the calendar reads as Kurir, not as a
  stripped Google Calendar.

## Non-goals

- No schema changes, no server-action changes to event CRUD, no
  mobile-API changes.
- No drag-to-move/resize inside the filmstrip (drag lives in the week
  grid; story flow has no stable time scale to drag against).
- No HEY feature set (labels/habits/sometime/highlight/photos) - next
  spec.

## Part A: Filmstrip day view

### Data flow

- Route stays `/calendar/day?date=YYYY-MM-DD` (phone `/calendar`
  redirect unchanged, so the filmstrip becomes the phone home view).
- The server component fetches the initial window: instances for
  `date - 3 .. date + 11` days via `listVisibleInstancesForUser`.
- New thin route handler `GET /api/calendar/instances?start&end`
  (session auth, same ownership checks, delegates to
  `listVisibleInstancesForUser`) feeds infinite scroll. Range capped
  (e.g. 31 days) to keep it unabusable.
- Client `Filmstrip` component holds a map of loaded days.
  IntersectionObserver sentinels at both ends fetch 7 more days when
  approached. Fetch failure renders a quiet retry line in the
  sentinel; no toast.

### Layout model

New pure module `src/lib/calendar/filmstrip-model.ts`:

```
buildFilmstrip(instances, days, timezone, now) -> FilmstripDay[]
```

Each `FilmstripDay` carries: date, header meta (weekday, numeral,
isToday, isWeekend, isPast), all-day rows, and an ordered list of flow
items:

- `event`: timed instance with a computed height - base entry height
  plus a duration factor, clamped (min one text row, max ~4 rows) so a
  4 h block cannot eat a screen.
- `freetime`: gap >= 2 h inside 07:00-21:00 (reuses `freetimeSpans` /
  `FREETIME_MIN_MINUTES`), with duration label data ("3 h free").
  Events with `transparency=free` do not split a gap (existing rule).
- `seam`: empty evening/night span collapsed to a thin dashed
  separator before the next day header. Events at night render
  normally; only empty spans collapse.
- `now`: marker positioned proportionally inside whatever item
  contains the current minute (today only).

Pure function, unit-tested; components stay dumb.

### Day anatomy (top to bottom)

- **Day header**: large tabular date numeral + weekday. Today's
  numeral terracotta; weekends get the muted wash; past days render
  slightly faded (the past sliding away). Not sticky.
- **All-day bars**: slim rows under the header (existing `EventBlock`
  chrome: 2px rail + faint tint).
- **Flow items**: event entries show start time (tabular), title
  (semibold), duration, 2px calendar rail, faint tint fill. Freetime
  blocks per Part B. Seams as above.
- **Empty day**: header plus a quiet muted "Nothing planned" line.
- **Now-marker**: 1px terracotta line + time label, re-rendered on a
  30 s client interval so it visibly creeps. The only loud accent.
- **Bottom sentinel**: while loading more days it shows a single
  Playfair line: "Time never stops." - the quote lives here.

### Interactions

- Tap freetime block -> event dialog prefilled with the gap's span.
- Tap "Nothing planned" -> event dialog for that day (default slot).
- Both creation taps use the same `canCreate` guard as week-grid slots
  (no writable calendar -> no affordance).
- Tap event -> existing event dialog (edit/delete unchanged).
- `New event` masthead button unchanged.
- Keyboard (`g e`, view toggle) unchanged.

### Scroll and URL

- First paint scrolls to the requested day's header; when the
  requested day is today, to the now-marker instead.
- On scroll, `history.replaceState` keeps `?date=` at the day under
  the viewport top; refresh/share lands where you were.
- Prepending past days must not jump the viewport: anchor scroll
  position around prepends (measure before, correct after).

## Part B: Freetime blocks

Replaces the floating centered `Free` word in `time-grid.tsx`.

- A qualifying gap renders as a bounded block: faint warm wash
  (`color-mix` off `background`, same technique as event tints),
  hairline top and bottom edges.
- Label top-left in the gap, small, muted, tabular: "3 h free"
  ("2.5 h free" for half hours). Never vertically centered.
- Click opens the event dialog prefilled with the gap span (week grid:
  only when the user can create, same `canCreate` guard as slots).
- Threshold and window unchanged: >= 2 h inside 07:00-21:00, nights
  unlabeled. Same visual treatment in week grid and filmstrip.

## Part C: Personality pass (week + month)

- **Today celebrated**: today's week column gets a warm background
  wash; its header numeral terracotta. Month's today cell matches.
- **Event chrome**: stronger tint fill, semibold title, start time
  inside the block when height allows (>= 45 min). Rail stays 2px; no
  shadows, no pills, no avatars (DESIGN.md rules hold).
- **Now-line**: keeps the 1px terracotta line; gains a small dot on
  the time-axis edge.
- **Month**: inherits today-cell accent and event chrome; no
  structural change.
- Masthead unchanged.

## Error handling

- Infinite-scroll fetch failure: inline retry line in the sentinel.
- `/api/calendar/instances` clamps ranges > 31 days to 31 and
  validates dates; unauthenticated -> 401.
- DST transition days: `filmstrip-model` computes gaps/durations from
  instants in `User.timezone` (via the existing range helpers), so a
  23 h/25 h day gets correct freetime and seams; covered by unit
  tests.

## Testing

- `filmstrip-model.test.ts`: windowing, flow-item ordering, height
  clamps, freetime detection (incl. transparency=free non-splitting),
  night-seam collapsing, now-position, DST days, empty days.
- Extend `grid-model` tests for freetime block bounds + label data.
- Route handler test: auth, range validation, clamping.
- Visual verification with agent-browser screenshots of week, day
  (filmstrip), month against the seeded demo, at desktop and phone
  widths, light and dark.

## Rollout

Pure view-layer change behind nothing - ships as one PR (or two:
freetime+personality, then filmstrip) on a `cfarvidson/` branch.
