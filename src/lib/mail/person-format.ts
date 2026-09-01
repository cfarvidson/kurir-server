/** Presentation helpers for the person profile (pure, client-safe). */

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** "45m", "3h", "2d 4h", "3w" - coarse on purpose; a median is not a stopwatch. */
export function formatResponseTime(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest >= 30 && hours < 10 ? `${hours}.5h` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    const restHours = hours % 24;
    return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
  }
  return `${Math.floor(days / 7)}w`;
}

/** { badge: "#3", tail: "of the 41 people you mail most" }; null when unranked. */
export function formatRank(
  position: number | null,
  of: number,
): { badge: string; tail: string } | null {
  if (position === null || of === 0) return null;
  return { badge: `#${position}`, tail: `of the ${of} people you mail most` };
}

/** Bar heights as 0-1 fractions of the busiest hour. */
export function histogramFractions(histogram: number[]): number[] {
  const max = Math.max(0, ...histogram);
  if (max === 0) return histogram.map(() => 0);
  return histogram.map((count) => count / max);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Shortest clockwise arc covering `hours`, as [start, endExclusive). */
function shortestHourRange(
  hours: number[],
): { start: number; endExclusive: number } | null {
  const unique = [...new Set(hours)].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  if (unique.length === 1) return { start: unique[0], endExclusive: unique[0] + 1 };
  let largestGap = -1;
  let startAfterGap = unique[0];
  for (let i = 0; i < unique.length; i++) {
    const current = unique[i];
    const next = unique[(i + 1) % unique.length];
    const gap = i === unique.length - 1 ? 24 - current + next : next - current;
    if (gap > largestGap) {
      largestGap = gap;
      startAfterGap = next;
    }
  }
  const span = 24 - largestGap + 1;
  const endExclusive = startAfterGap + span;
  return {
    start: startAfterGap,
    endExclusive: endExclusive > 24 ? endExclusive % 24 : endExclusive,
  };
}

/**
 * "Usually writes 09-12" for the shortest hour range covering buckets at
 * or above half the peak. Null when empty, a single mail, or every
 * non-zero bucket is the same height.
 */
export function formatBusyHours(histogram: number[]): string | null {
  if (histogram.length !== 24) return null;
  const total = histogram.reduce((sum, n) => sum + n, 0);
  if (total <= 1) return null;
  const nonZero = histogram.filter((n) => n > 0);
  const first = nonZero[0];
  if (first === undefined || nonZero.every((n) => n === first)) return null;
  const peak = Math.max(...histogram);
  const qualifying = histogram
    .map((count, hour) => (count * 2 >= peak ? hour : -1))
    .filter((hour) => hour >= 0);
  const range = shortestHourRange(qualifying);
  if (!range) return null;
  return `Usually writes ${pad2(range.start)}-${pad2(range.endExclusive)}`;
}

/** "Replies in 4h"; null when there is no paired reply. */
export function formatRepliesIn(seconds: number | null): string | null {
  const time = formatResponseTime(seconds);
  return time ? `Replies in ${time}` : null;
}
