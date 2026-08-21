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
  zonedWallToUtc,
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

  // Prepend without viewport jump: correct scrollTop after a "past" extend
  // shifts range.start earlier.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (node == null || prependCorrection.current == null) return;
    node.scrollTop += node.scrollHeight - prependCorrection.current;
    prependCorrection.current = null;
  }, [range.start]);

  useEffect(() => {
    const root = containerRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!root || !top || !bottom) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === top) void extend("past");
          if (entry.target === bottom) void extend("future");
        }
      },
      { root, rootMargin: "600px 0px" },
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [extend]);

  const days = useMemo(
    () => daySpan(range.start, range.endExclusive),
    [range],
  );
  const model = useMemo(
    () => buildFilmstrip([...byKey.values()], days, timezone, now),
    [byKey, days, timezone, now],
  );

  // Initial scroll, once: to the now-line when present, else the anchor's
  // day section.
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

  // Visible-day tracking: rAF-throttled scroll handler, URL sync via
  // history.replaceState (not router.replace, which would re-render the
  // server component on every scroll).
  const lastReportedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let rafId: number | null = null;
    function handleScroll() {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const scrollTop = node!.scrollTop;
        const sections = node!.querySelectorAll<HTMLElement>(
          "[data-filmstrip-day]",
        );
        let current: HTMLElement | null = null;
        for (const section of sections) {
          if (section.offsetTop <= scrollTop + 24) {
            current = section;
          } else {
            break;
          }
        }
        const key = current?.dataset.filmstripDay;
        if (!key || key === lastReportedKeyRef.current) return;
        lastReportedKeyRef.current = key;
        window.history.replaceState(null, "", `/calendar/day?date=${key}`);
        const [year, month, day] = key.split("-").map(Number);
        onVisibleDayChange?.({ year, month, day });
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
