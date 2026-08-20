export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function needsOnTheFlyExpand(
  from: Date,
  to: Date,
  window: { from: Date; to: Date },
): boolean {
  return from < window.from || to > window.to;
}

export function allDayUtcBounds(
  startDate: string,
  endDateExclusive: string,
): { startAt: Date; endAt: Date } {
  return {
    startAt: new Date(`${startDate}T00:00:00.000Z`),
    endAt: new Date(`${endDateExclusive}T00:00:00.000Z`),
  };
}

type FreetimeInstance = {
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  transparency: "busy" | "free";
};

export function freetimeSpans(
  instances: FreetimeInstance[],
  dayStart: Date,
  dayEnd: Date,
  minMinutes: number,
): { startAt: Date; endAt: Date }[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const minMs = minMinutes * 60_000;

  const busy = instances
    .filter((i) => !i.isAllDay && !i.isCancelled && i.transparency === "busy")
    .map((i) => {
      const start = Math.max(i.startAt.getTime(), dayStartMs);
      const end = Math.min(i.endAt.getTime(), dayEndMs);
      return { start, end };
    })
    .filter((i) => i.start < i.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge overlapping / touching busy intervals (half-open friendly).
  const merged: { start: number; end: number }[] = [];
  for (const block of busy) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  const spans: { startAt: Date; endAt: Date }[] = [];
  let cursor = dayStartMs;
  for (const block of merged) {
    if (block.start - cursor >= minMs) {
      spans.push({
        startAt: new Date(cursor),
        endAt: new Date(block.start),
      });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (dayEndMs - cursor >= minMs) {
    spans.push({
      startAt: new Date(cursor),
      endAt: new Date(dayEndMs),
    });
  }
  return spans;
}
