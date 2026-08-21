"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FreetimeBlock } from "@/components/calendar/freetime-block";
import { EventBlock } from "@/components/calendar/event-block";
import {
  buildFilmstrip,
  WINDOW_BACK,
  WINDOW_FORWARD,
  type FilmstripDay,
  type FilmstripItem,
} from "@/components/calendar/filmstrip-model";
import { compareCivil } from "@/components/calendar/grid-model";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { eventBlockStyle } from "@/lib/calendar/color";
import {
  addDays,
  formatDateParam,
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
 * The scroll target for a day: its now-line when the day has one, else the
 * section itself. Both are scoped to the day so a strip that also renders
 * today doesn't steal the target.
 */
function dayScrollTarget(node: HTMLElement, key: string): HTMLElement | null {
  return (
    node.querySelector<HTMLElement>(
      `[data-filmstrip-day="${key}"] [data-filmstrip-now]`,
    ) ?? node.querySelector<HTMLElement>(`[data-filmstrip-day="${key}"]`)
  );
}

/**
 * The container has no positioned ancestor, so `offsetTop` would resolve
 * against <body> (or, for the now-line, against its own nearer positioned
 * wrapper) instead of the scroll container — use getBoundingClientRect deltas.
 */
function scrollTargetIntoView(node: HTMLElement, target: HTMLElement) {
  const containerTop = node.getBoundingClientRect().top;
  const targetTop =
    target.getBoundingClientRect().top - containerTop + node.scrollTop;
  node.scrollTop = Math.max(0, targetTop - node.clientHeight / 3);
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

function itemKey(item: FilmstripItem): string {
  if (item.kind === "seam") return "seam";
  const idPart = item.kind === "event" ? `:${item.instance.eventId}` : "";
  return `${item.kind}:${item.startMin}${idPart}`;
}

function NowLine({ label }: { label: string }) {
  return (
    <div
      data-filmstrip-now
      aria-hidden
      className="relative z-10 h-px bg-primary"
    >
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
  scrollToRequest,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
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
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
          prependCorrection.current =
            containerRef.current?.scrollHeight ?? null;
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

  // Prepend without viewport jump: correct scrollTop after a "past" extend
  // shifts range.start earlier.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (node == null || prependCorrection.current == null) return;
    node.scrollTop += node.scrollHeight - prependCorrection.current;
    prependCorrection.current = null;
  }, [range.start]);

  // Sentinels are observed once. Attaching is deferred until the initial
  // scroll has positioned the viewport, so a sentinel that starts within
  // rootMargin of scrollTop 0 doesn't fire an extend before the anchor day
  // is even in view.
  useEffect(() => {
    const root = containerRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!root || !top || !bottom) return;

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
            if (entry.target === top) void extendRef.current("past");
            if (entry.target === bottom) void extendRef.current("future");
          }
        },
        { root, rootMargin: "600px 0px" },
      );
      observer.observe(top!);
      observer.observe(bottom!);
    }
    attach();

    return () => {
      observer?.disconnect();
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const days = useMemo(
    () => daySpan(range.start, range.endExclusive),
    [range],
  );
  const model = useMemo(
    () => buildFilmstrip([...byKey.values()], days, timezone, now),
    [byKey, days, timezone, now],
  );

  // Initial scroll, once: to the anchor day's now-line when it has one, else
  // to the anchor's section.
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const node = containerRef.current;
    if (!node) return;
    const key = formatDateParam(anchor);
    const target = dayScrollTarget(node, key);
    if (target) scrollTargetIntoView(node, target);
    lastReportedKeyRef.current = key;
    didInitialScroll.current = true;
  }, [anchor]);

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
    const node = containerRef.current;
    if (!node) return;
    const target = dayScrollTarget(node, pendingScroll);
    if (!target) return;
    scrollTargetIntoView(node, target);
    // Keep the scroll handler from immediately reporting a stale day back.
    lastReportedKeyRef.current = pendingScroll;
    setPendingScroll(null);
  }, [pendingScroll, model]);

  // Visible-day tracking: rAF-throttled scroll handler, URL sync via
  // history.replaceState (not router.replace, which would re-render the
  // server component on every scroll).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let rafId: number | null = null;
    function handleScroll() {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        // Same rect-based positioning as the initial scroll: the container
        // isn't a positioned ancestor, so compare each section's top
        // relative to the container's own rect instead of offsetTop.
        const containerTop = node!.getBoundingClientRect().top;
        const sections = node!.querySelectorAll<HTMLElement>(
          "[data-filmstrip-day]",
        );
        let current: HTMLElement | null = null;
        for (const section of sections) {
          const top = section.getBoundingClientRect().top - containerTop;
          if (top <= 24) {
            current = section;
          } else {
            break;
          }
        }
        const key = current?.dataset.filmstripDay;
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
    <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <div ref={topRef} className="py-8 text-center">
          {loadError === "past" && (
            <button
              type="button"
              onClick={() => void extend("past")}
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              Couldn&apos;t load more days — retry
            </button>
          )}
        </div>
        {model.map((day) => (
          <FilmstripDaySection
            key={day.key}
            day={day}
            canCreate={canCreate}
            onSelectSlot={onSelectSlot}
            onEventClick={onEventClick}
          />
        ))}
        <div ref={bottomRef} className="py-8 text-center">
          {loadError === "future" ? (
            <button
              type="button"
              onClick={() => void extend("future")}
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
      </div>
    </div>
  );
}

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
      <div key={itemKey(item)} className="relative">
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
      className={cn(
        "pt-6",
        day.isWeekend && "bg-muted/20",
        day.isPast && "opacity-60",
      )}
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
        <>
          {day.isToday && day.now && <NowLine label={day.nowTimeLabel ?? ""} />}
          {canCreate ? (
            <button
              type="button"
              onClick={() =>
                onSelectSlot({
                  date: day.key,
                  startMin: 9 * 60,
                  endMin: 10 * 60,
                  allDay: false,
                })
              }
              className="w-full rounded-xs px-3 py-4 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              Nothing planned
            </button>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Nothing planned
            </p>
          )}
        </>
      )}
      {!hasEvents && (
        <div aria-hidden className="my-3 border-t border-dashed border-border" />
      )}
    </section>
  );
}
