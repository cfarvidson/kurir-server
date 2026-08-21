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

export type FilmstripItem =
  | {
      kind: "event";
      instance: CalendarInstanceDTO;
      startMin: number;
      endMin: number;
      heightPx: number;
      startLabel: string; // "09:00"
      durationLabel: string; // "1 h"
    }
  | {
      kind: "freetime";
      startMin: number;
      endMin: number;
      heightPx: number;
      minutes: number; // endMin - startMin, for FreetimeBlock
    }
  | { kind: "seam" };

export type NowMarker =
  | { kind: "in-item"; index: number; fraction: number } // 0..1 within items[index]
  | { kind: "between"; beforeIndex: number }; // render before items[beforeIndex]

export type FilmstripDay = {
  date: CivilDate;
  key: string; // "YYYY-MM-DD"
  isToday: boolean;
  isWeekend: boolean;
  isPast: boolean; // civil day strictly before today
  allDay: CalendarInstanceDTO[];
  items: FilmstripItem[]; // ordered by startMin, seam always last
  now: NowMarker | null; // only set when isToday
  nowTimeLabel: string | null; // "13:37" when now is set, else null
};

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
    const timed = timedEventsOnDay(instances, day, timezone).map(
      (instance) => {
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
      },
    );
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
