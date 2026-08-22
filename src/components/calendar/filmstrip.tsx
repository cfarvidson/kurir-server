"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { EventBlock } from "@/components/calendar/event-block";
import {
  buildFilmstrip,
  minuteForX,
  MIN_SLAT_PX,
  stripDayOffsets,
  stripIndexAtOffset,
  stripOffsetForIndex,
  WINDOW_BACK,
  WINDOW_FORWARD,
  xForMinute,
  type FilmstripDay,
  type FilmstripSlat,
  type FreetimeZone,
} from "@/components/calendar/filmstrip-model";
import {
  compareCivil,
  snapMinutes,
  wallFromMinutes,
} from "@/components/calendar/grid-model";
import {
  pointerPastThreshold,
  timedPlacementChanged,
} from "@/components/calendar/timed-drag";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";
import {
  addDays,
  DAY_MINUTES,
  formatDateParam,
  formatFreetimeLabel,
  formatWeekdayShort,
  zonedWallToUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

type DayRange = { start: CivilDate; endExclusive: CivilDate };

function windowAround(day: CivilDate): DayRange {
  return {
    start: addDays(day, -WINDOW_BACK),
    endExclusive: addDays(day, WINDOW_FORWARD),
  };
}

function rangeCovers(range: DayRange, day: CivilDate): boolean {
  return (
    compareCivil(range.start, day) <= 0 &&
    compareCivil(day, range.endExclusive) < 0
  );
}

function civilFromKey(key: string): CivilDate {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/**
 * The first day section's offset from content left. Day widths come from
 * the model, so this single rect read is the only DOM measurement the
 * strip's scroll math needs.
 */
function measureBase(node: HTMLElement): number | null {
  const first = node.querySelector<HTMLElement>("[data-filmstrip-day]");
  if (!first) return null;
  return (
    first.getBoundingClientRect().left -
    node.getBoundingClientRect().left +
    node.scrollLeft
  );
}

function daySpan(start: CivilDate, endExclusive: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  let cursor = start;
  while (formatDateParam(cursor) !== formatDateParam(endExclusive)) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

type StripDrag =
  | {
      type: "create";
      dayKey: string;
      originMin: number;
      startMin: number;
      endMin: number;
    }
  | {
      type: "move";
      event: CalendarInstanceDTO;
      dayKey: string;
      originDayKey: string;
      pointerOrigin: number;
      originalStart: number;
      originalEnd: number;
      startMin: number;
      endMin: number;
    };

// The night sky is fixed-dark in both themes, like the event fills: film
// stock doesn't change color with the app theme.
const NIGHT_FILL = "#191b2f";
const NIGHT_STARS = [
  "radial-gradient(1px 1px at 12px 18px, rgba(255,255,255,0.55) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 26px 54px, rgba(255,255,255,0.35) 50%, transparent 51%)",
  "radial-gradient(1.5px 1.5px at 8px 92px, rgba(255,255,255,0.45) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 30px 124px, rgba(255,255,255,0.3) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 18px 150px, rgba(255,255,255,0.5) 50%, transparent 51%)",
].join(", ");

export function Filmstrip({
  anchor,
  instances,
  timezone,
  canCreate,
  onSelectSlot,
  onEventClick,
  onTimedCommit,
  onVisibleDayChange,
  scrollToRequest,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onTimedCommit: (
    event: CalendarInstanceDTO,
    startAt: Date,
    endAt: Date,
  ) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
  /**
   * Nav intent from the shell (prev/next/Today). The strip stays mounted
   * across `?date=` navigations, so a bumped nonce — not a changed anchor —
   * is what tells it to reposition.
   */
  scrollToRequest?: { key: string; nonce: number };
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [range, setRange] = useState<DayRange>(() => windowAround(anchor));
  const [byKey, setByKey] = useState<Map<string, CalendarInstanceDTO>>(
    () => new Map(instances.map((i) => [`${i.eventId}:${i.startAt}`, i])),
  );
  const [loadError, setLoadError] = useState<"past" | "future" | null>(null);
  const loadingRef = useRef<{ past: boolean; future: boolean }>({
    past: false,
    future: false,
  });

  // Server refresh reconciliation: when the `instances` prop changes (create/
  // edit/delete triggers router.refresh()), drop stored entries that overlap
  // the server window and re-add the fresh ones.
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

  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const prependCorrection = useRef<number | null>(null);
  const didInitialScroll = useRef(false);
  const lastReportedKeyRef = useRef<string | null>(null);

  // A day the strip should scroll to once it is rendered. Set by nav intents
  // and by anchor changes that didn't come from our own replaceState.
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const requestScroll = useCallback((key: string) => {
    const day = civilFromKey(key);
    setRange((prev) => (rangeCovers(prev, day) ? prev : windowAround(day)));
    setPendingScroll(key);
  }, []);

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
        if (direction === "past") {
          prependCorrection.current = containerRef.current?.scrollWidth ?? null;
        }
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

  // Keep a stable ref to the latest `extend` so the IntersectionObserver
  // below can be created once instead of being torn down and recreated
  // (and re-firing against a sentinel still inside rootMargin) on every
  // successful extend.
  const extendRef = useRef(extend);
  useEffect(() => {
    extendRef.current = extend;
  }, [extend]);

  // Prepend without viewport jump: correct scrollLeft after a "past" extend
  // shifts range.start earlier.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (node == null || prependCorrection.current == null) return;
    node.scrollLeft += node.scrollWidth - prependCorrection.current;
    prependCorrection.current = null;
  }, [range.start]);

  // Sentinels are observed once. Attaching is deferred until the initial
  // scroll has positioned the viewport, so a sentinel that starts within
  // rootMargin of scrollLeft 0 doesn't fire an extend before the anchor day
  // is even in view.
  useEffect(() => {
    const root = containerRef.current;
    const start = startRef.current;
    const end = endRef.current;
    if (!root || !start || !end) return;

    let observer: IntersectionObserver | undefined;
    let rafId: number | undefined;

    function attach() {
      if (!didInitialScroll.current) {
        rafId = window.requestAnimationFrame(attach);
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (entry.target === start) void extendRef.current("past");
            if (entry.target === end) void extendRef.current("future");
          }
        },
        { root, rootMargin: "0px 600px" },
      );
      observer.observe(start!);
      observer.observe(end!);
    }
    attach();

    return () => {
      observer?.disconnect();
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const days = useMemo(() => daySpan(range.start, range.endExclusive), [range]);
  const model = useMemo(
    () => buildFilmstrip([...byKey.values()], days, timezone, now),
    [byKey, days, timezone, now],
  );
  // The scroll handler reads day keys and offsets without re-binding on
  // every extend.
  const modelRef = useRef<FilmstripDay[]>([]);
  modelRef.current = model;
  const dayMetaRef = useRef<{ keys: string[]; offsets: number[] }>({
    keys: [],
    offsets: [],
  });
  dayMetaRef.current = {
    keys: model.map((day) => day.key),
    offsets: stripDayOffsets(model.map((day) => day.widthPx)),
  };

  // Drag interactions (mouse/pen; touch pans the strip). The proportional
  // axis makes pointer x <-> minute a pure mapping, so drag-create and
  // drag-move mirror the week grid's semantics: 6 px threshold, 15 min
  // snap, commit through the same onTimedCommit path.
  const [drag, setDrag] = useState<StripDrag | null>(null);
  const dragRef = useRef<StripDrag | null>(null);
  const suppressClick = useRef(false);

  const sectionFor = useCallback((key: string): HTMLElement | null => {
    return (
      containerRef.current?.querySelector<HTMLElement>(
        `[data-filmstrip-day="${key}"]`,
      ) ?? null
    );
  }, []);

  const dayAtPointer = useCallback(
    (clientX: number): { day: FilmstripDay; node: HTMLElement } | null => {
      for (const day of modelRef.current) {
        const node = sectionFor(day.key);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (clientX >= rect.left && clientX < rect.right) {
          return { day, node };
        }
      }
      return null;
    },
    [sectionFor],
  );

  function minutesAt(day: FilmstripDay, node: HTMLElement, clientX: number) {
    return snapMinutes(
      minuteForX(day.spans, clientX - node.getBoundingClientRect().left),
    );
  }

  function finishStripDrag(next: StripDrag) {
    if (next.type === "create") {
      const startMin = Math.min(next.startMin, next.endMin);
      const endMin = Math.max(next.startMin, next.endMin);
      onSelectSlot({
        date: next.dayKey,
        startMin,
        endMin: Math.max(endMin, startMin + 30),
        allDay: false,
      });
      return;
    }
    if (next.event.isReadOnly) return;
    if (
      !timedPlacementChanged({
        originalDay: next.originDayKey,
        currentDay: next.dayKey,
        originalStart: next.originalStart,
        originalEnd: next.originalEnd,
        startMin: next.startMin,
        endMin: next.endMin,
      })
    ) {
      return;
    }
    const day = civilFromKey(next.dayKey);
    onTimedCommit(
      next.event,
      wallFromMinutes(day, next.startMin, timezone),
      wallFromMinutes(day, next.endMin, timezone),
    );
  }

  function bindStripDrag(start: StripDrag, originX: number, originY: number) {
    const isCreate = start.type === "create";
    setDrag(isCreate ? start : null);
    dragRef.current = start;
    suppressClick.current = false;
    let armed = isCreate;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      if (
        !armed &&
        !pointerPastThreshold(originX, originY, event.clientX, event.clientY)
      ) {
        return;
      }
      if (!armed) {
        armed = true;
        if (current.type !== "create") suppressClick.current = true;
      }
      if (current.type === "create") {
        // Create stays within its origin day; the pointer x is clamped to
        // that section so the preview never jumps across the night band.
        const node = sectionFor(current.dayKey);
        const dayIndex = dayMetaRef.current.keys.indexOf(current.dayKey);
        const day = modelRef.current[dayIndex];
        if (!node || !day) return;
        const minutes = minutesAt(day, node, event.clientX);
        if (Math.abs(minutes - current.originMin) >= 15) {
          suppressClick.current = true;
        }
        const startMin = Math.min(current.originMin, minutes);
        const endMin = Math.max(current.originMin, minutes);
        const next: StripDrag = {
          ...current,
          startMin,
          endMin: Math.max(endMin, startMin + 15),
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }
      const hit = dayAtPointer(event.clientX);
      if (!hit) return;
      const minutes = minutesAt(hit.day, hit.node, event.clientX);
      const duration = current.originalEnd - current.originalStart;
      const startMin = Math.max(
        0,
        Math.min(
          DAY_MINUTES - 15,
          snapMinutes(current.originalStart + (minutes - current.pointerOrigin)),
        ),
      );
      const next: StripDrag = {
        ...current,
        dayKey: hit.day.key,
        startMin,
        endMin: Math.min(DAY_MINUTES, startMin + duration),
      };
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const current = dragRef.current;
      setDrag(null);
      dragRef.current = null;
      if (current?.type === "create") {
        finishStripDrag(current);
      } else if (current && armed) {
        if (
          timedPlacementChanged({
            originalDay: current.originDayKey,
            currentDay: current.dayKey,
            originalStart: current.originalStart,
            originalEnd: current.originalEnd,
            startMin: current.startMin,
            endMin: current.endMin,
          })
        ) {
          finishStripDrag(current);
        } else {
          suppressClick.current = false;
        }
      }
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onCanvasPointerDown(
    day: FilmstripDay,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0 || !canCreate || event.pointerType === "touch") {
      return;
    }
    const node = sectionFor(day.key);
    if (!node) return;
    const minutes = minutesAt(day, node, event.clientX);
    bindStripDrag(
      {
        type: "create",
        dayKey: day.key,
        originMin: minutes,
        startMin: minutes,
        endMin: Math.min(DAY_MINUTES, minutes + 60),
      },
      event.clientX,
      event.clientY,
    );
  }

  function onSlatPointerDown(
    day: FilmstripDay,
    slat: FilmstripSlat,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    if (
      event.button !== 0 ||
      slat.instance.isReadOnly ||
      event.pointerType === "touch"
    ) {
      return;
    }
    const node = sectionFor(day.key);
    if (!node) return;
    bindStripDrag(
      {
        type: "move",
        event: slat.instance,
        dayKey: day.key,
        originDayKey: day.key,
        pointerOrigin: minutesAt(day, node, event.clientX),
        originalStart: slat.startMin,
        originalEnd: slat.endMin,
        startMin: slat.startMin,
        endMin: slat.endMin,
      },
      event.clientX,
      event.clientY,
    );
  }

  const positionStrip = useCallback((key: string): boolean => {
    const node = containerRef.current;
    if (!node) return false;
    const { keys, offsets } = dayMetaRef.current;
    const index = keys.indexOf(key);
    const base = measureBase(node);
    if (index === -1 || base == null) return false;
    let target = stripOffsetForIndex(index, base, offsets);
    const day = modelRef.current[index];
    // Today lands with the now-line at 40% of the viewport (never left of
    // the day's own start, so the visible-day probe stays inside today).
    if (day?.isToday && day.nowXPx != null) {
      target = Math.max(
        target,
        base + offsets[index] + day.nowXPx - node.clientWidth * 0.4,
      );
    }
    node.scrollLeft = target;
    return true;
  }, []);

  // Initial scroll, once: the anchor day lands at the strip's left edge
  // (today centers its now-line instead).
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    positionStrip(formatDateParam(anchor));
    lastReportedKeyRef.current = formatDateParam(anchor);
    didInitialScroll.current = true;
  }, [anchor, positionStrip]);

  // Nav intent from the shell: prev/next/Today must reposition the strip even
  // when `?date=` (and so `anchor`) is unchanged, which is why this keys off
  // the request object rather than the anchor.
  useEffect(() => {
    if (!scrollToRequest) return;
    requestScroll(scrollToRequest.key);
  }, [scrollToRequest, requestScroll]);

  // Anchor changes the strip didn't cause itself (direct URL load, back/
  // forward) also reposition it. Our own replaceState round-tripping through
  // a refresh is ignored.
  const lastAnchorKeyRef = useRef(formatDateParam(anchor));
  useEffect(() => {
    const key = formatDateParam(anchor);
    if (key === lastAnchorKeyRef.current) return;
    lastAnchorKeyRef.current = key;
    if (key === lastReportedKeyRef.current) return;
    requestScroll(key);
  }, [anchor, requestScroll]);

  // Runs again on every model change until the requested day is rendered:
  // a jump outside the current range only paints after `range` settles.
  useLayoutEffect(() => {
    if (pendingScroll == null || !didInitialScroll.current) return;
    if (!positionStrip(pendingScroll)) return;
    // Keep the scroll handler from immediately reporting a stale day back.
    // That early-return also swallows onVisibleDayChange, so report the day
    // from here — otherwise a nonce-only nav (Today while the URL has drifted)
    // fixes the strip and the URL but leaves the shell on the drifted day.
    lastReportedKeyRef.current = pendingScroll;
    onVisibleDayChange?.(civilFromKey(pendingScroll));
    setPendingScroll(null);
  }, [pendingScroll, model, onVisibleDayChange, positionStrip]);

  // Visible-day tracking: rAF-throttled scroll handler, URL sync via
  // history.replaceState (not router.replace, which would re-render the
  // server component on every scroll). The probe point sits a third into
  // the viewport so the day most of the screen shows wins.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let rafId: number | null = null;
    function handleScroll() {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const base = measureBase(node!);
        if (base == null) return;
        const index = stripIndexAtOffset(
          node!.scrollLeft + node!.clientWidth / 3,
          base,
          dayMetaRef.current.offsets,
        );
        const key = dayMetaRef.current.keys[index];
        if (!key || key === lastReportedKeyRef.current) return;
        lastReportedKeyRef.current = key;
        try {
          window.history.replaceState(null, "", `/calendar/day?date=${key}`);
        } catch {
          // iOS Safari throttles replaceState (~100 calls / 30 s) and throws
          // past the limit. The URL falling behind is cosmetic.
        }
        onVisibleDayChange?.(civilFromKey(key));
      });
    }
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", handleScroll);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, [onVisibleDayChange]);

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
    >
      <div ref={startRef} className="flex w-12 shrink-0 items-center">
        {loadError === "past" && (
          <button
            type="button"
            onClick={() => void extend("past")}
            className="w-full -rotate-90 whitespace-nowrap text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Retry
          </button>
        )}
      </div>
      {model.map((day) => (
        <FilmstripDaySection
          key={day.key}
          day={day}
          canCreate={canCreate}
          drag={drag}
          suppressClick={suppressClick}
          onSelectSlot={onSelectSlot}
          onEventClick={onEventClick}
          onCanvasPointerDown={onCanvasPointerDown}
          onSlatPointerDown={onSlatPointerDown}
        />
      ))}
      <div
        ref={endRef}
        className="flex w-44 shrink-0 items-center justify-center px-6"
      >
        {loadError === "future" ? (
          <button
            type="button"
            onClick={() => void extend("future")}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Couldn&apos;t load more days — retry
          </button>
        ) : (
          <p className="text-center font-serif text-sm italic text-muted-foreground">
            Time never stops.
          </p>
        )}
      </div>
    </div>
  );
}

function FilmstripDaySection({
  day,
  canCreate,
  drag,
  suppressClick,
  onSelectSlot,
  onEventClick,
  onCanvasPointerDown,
  onSlatPointerDown,
}: {
  day: FilmstripDay;
  canCreate: boolean;
  drag: StripDrag | null;
  suppressClick: RefObject<boolean>;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onCanvasPointerDown: (
    day: FilmstripDay,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onSlatPointerDown: (
    day: FilmstripDay,
    slat: FilmstripSlat,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const [leadNight, trailNight] = day.nights;
  const daytimeX = leadNight.widthPx;
  const daytimeWidth = trailNight.xPx - daytimeX;
  const isEmpty = day.slats.length === 0 && day.allDay.length === 0;

  return (
    <section
      data-filmstrip-day={day.key}
      style={{ width: day.widthPx }}
      className={cn(
        "relative flex shrink-0 flex-col",
        day.isPast && "opacity-60",
      )}
    >
      {/* Ground layer: daytime wash, then the night bands. */}
      {(day.isToday || day.isWeekend) && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-y-0 z-0",
            day.isToday ? "bg-primary/5" : "bg-muted/30",
          )}
          style={{ left: daytimeX, width: daytimeWidth }}
        />
      )}
      {day.nights.map((night) => (
        <div
          key={night.edge}
          aria-hidden
          className="absolute inset-y-0 z-0"
          style={{
            left: night.xPx,
            width: night.widthPx,
            backgroundColor: NIGHT_FILL,
            backgroundImage: NIGHT_STARS,
            backgroundSize: "36px 168px",
          }}
        >
          {/* Midnight: the day boundary runs through the merged night band. */}
          {night.edge === "trail" && (
            <span className="absolute inset-y-0 right-0 w-px bg-white/15" />
          )}
        </div>
      ))}
      {day.isToday && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-20 h-0.5 bg-primary"
        />
      )}

      {/* Hour axis with the day's own label. */}
      <div className="relative z-10 h-7 shrink-0">
        {/* Sticky, so the day stays identifiable while its band is in view. */}
        <span
          className={cn(
            "sticky z-20 mt-1 inline-block rounded-xs bg-background/80 px-1 text-[10px] font-medium uppercase tracking-wider",
            day.isToday ? "text-primary" : "text-muted-foreground",
          )}
          style={{ marginLeft: daytimeX + 2, left: 8 }}
        >
          {formatWeekdayShort(day.date)} {day.date.day}
        </span>
        {day.hourTicks.slice(1).map((tick) => (
          <span
            key={tick.hour}
            aria-hidden
            className="absolute top-1.5 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground/70"
            style={{ left: tick.xPx }}
          >
            {String(tick.hour).padStart(2, "0")}
          </span>
        ))}
        {day.nowXPx != null && (
          <span
            className="absolute top-1.5 z-20 -translate-x-1/2 bg-background/80 px-0.5 text-[10px] font-medium tabular-nums text-primary"
            style={{ left: day.nowXPx }}
          >
            {day.nowTimeLabel}
          </span>
        )}
      </div>

      {/* All-day bars span the daytime band. */}
      {day.allDay.length > 0 && (
        <div
          className="relative z-10 shrink-0 space-y-0.5 pb-1"
          style={{ paddingLeft: daytimeX, paddingRight: trailNight.widthPx }}
        >
          {day.allDay.map((row) => (
            <EventBlock
              key={`${row.eventId}:${row.startAt}`}
              title={row.title}
              color={row.color}
              muted={row.transparency === "free"}
              className="relative h-5"
              onClick={() => onEventClick(row)}
            />
          ))}
        </div>
      )}

      {/* The canvas: hour lines, freetime zones, event slats, now-line. */}
      <div
        className="relative z-10 min-h-0 flex-1"
        onPointerDown={(event) => onCanvasPointerDown(day, event)}
      >
        {day.hourTicks.slice(1).map((tick) => (
          <div
            key={tick.hour}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border/50"
            style={{ left: tick.xPx }}
          />
        ))}
        {isEmpty && (
          <span
            className="pointer-events-none absolute whitespace-nowrap text-sm text-muted-foreground"
            style={{
              left: daytimeX + daytimeWidth / 2,
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            Nothing planned
          </span>
        )}
        {day.freetime.map((zone) => (
          <FreetimeStripZone
            key={zone.startMin}
            zone={zone}
            onSelect={
              canCreate
                ? () => {
                    if (suppressClick.current) return;
                    onSelectSlot({
                      date: day.key,
                      startMin: zone.startMin,
                      endMin: zone.endMin,
                      allDay: false,
                    });
                  }
                : undefined
            }
          />
        ))}
        {day.slats.map((slat) => {
          if (
            drag?.type === "move" &&
            drag.event.eventId === slat.instance.eventId
          ) {
            return null;
          }
          return (
            <EventSlat
              key={`${slat.instance.eventId}:${slat.startMin}:${slat.lane}`}
              slat={slat}
              onClick={() => {
                if (suppressClick.current) return;
                onEventClick(slat.instance);
              }}
              onPointerDown={(event) => onSlatPointerDown(day, slat, event)}
            />
          );
        })}
        {drag && drag.dayKey === day.key && (
          <StripDragPreview drag={drag} day={day} />
        )}
        {day.nowXPx != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-20 border-l border-dashed border-primary"
            style={{ left: day.nowXPx }}
          />
        )}
      </div>
    </section>
  );
}

/**
 * A qualifying gap reads like HEY's: a quiet duration label on the
 * baseline. The label is the click target that claims the whole span —
 * the zone itself lets pointer events through so drag-create owns the
 * canvas (same split as the week grid's FreetimeBlock).
 */
function FreetimeStripZone({
  zone,
  onSelect,
}: {
  zone: FreetimeZone;
  onSelect?: () => void;
}) {
  const label = formatFreetimeLabel(zone.minutes);
  return (
    <div
      className="pointer-events-none absolute inset-y-0"
      style={{ left: zone.xPx, width: zone.widthPx }}
    >
      {onSelect ? (
        <button
          type="button"
          aria-label={`New event, ${label}`}
          className="pointer-events-auto absolute bottom-1.5 left-1.5 whitespace-nowrap rounded-xs px-0.5 text-[11px] tabular-nums text-muted-foreground/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {label}
        </button>
      ) : (
        <span className="absolute bottom-2 left-2 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/70">
          {label}
        </span>
      )}
    </div>
  );
}

/** Live preview while dragging: a primary band for create, a ghost slat for move. */
function StripDragPreview({
  drag,
  day,
}: {
  drag: StripDrag;
  day: FilmstripDay;
}) {
  const x1 = xForMinute(day.spans, drag.startMin);
  const x2 = xForMinute(day.spans, drag.endMin);
  if (drag.type === "create") {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 z-30 rounded-xs bg-primary/10 ring-1 ring-inset ring-primary/40"
        style={{ left: x1, width: Math.max(x2 - x1, 2) }}
      />
    );
  }
  const fill = normalizeEventHex(drag.event.color);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 z-30 rounded-sm opacity-80"
      style={{
        left: x1,
        width: Math.max(x2 - x1, MIN_SLAT_PX),
        backgroundColor: fill,
      }}
    />
  );
}

/**
 * A timed event as a vertical slat: solid calendar color, width
 * proportional to duration, text rotated to read bottom-to-top (HEY's
 * filmstrip frames). Events with transparency=free render as a hatched
 * outline instead of a solid fill.
 */
function EventSlat({
  slat,
  onClick,
  onPointerDown,
}: {
  slat: FilmstripSlat;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const fill = normalizeEventHex(slat.instance.color);
  const tone = readableTextTone(fill);
  const tentative = slat.instance.transparency === "free";
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={`${slat.startLabel} · ${slat.instance.title}`}
      className={cn(
        "absolute overflow-hidden rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        tentative
          ? "text-foreground"
          : tone === "light"
            ? "text-white"
            : "text-zinc-950",
      )}
      style={{
        left: slat.xPx,
        width: slat.widthPx,
        top: `${(slat.lane / slat.lanes) * 100}%`,
        height: `${100 / slat.lanes}%`,
        ...(tentative
          ? {
              backgroundImage: `repeating-linear-gradient(135deg, ${fill}33 0 5px, transparent 5px 10px)`,
              boxShadow: `inset 0 0 0 1px ${fill}66`,
            }
          : { backgroundColor: fill }),
      }}
    >
      <span className="block h-full w-full rotate-180 overflow-hidden px-1.5 py-2 [writing-mode:vertical-rl]">
        {/* Narrow slats give the title the whole width. */}
        {slat.widthPx >= 44 && (
          <span
            className={cn(
              "block whitespace-nowrap text-[11px] tabular-nums",
              tentative
                ? "text-muted-foreground"
                : tone === "light"
                  ? "text-white/75"
                  : "text-zinc-950/70",
            )}
          >
            {slat.startLabel} · {slat.durationLabel}
          </span>
        )}
        <span
          className={cn(
            "block whitespace-nowrap text-sm font-semibold",
            tentative && "font-serif italic",
          )}
        >
          {slat.instance.title}
        </span>
      </span>
    </button>
  );
}
