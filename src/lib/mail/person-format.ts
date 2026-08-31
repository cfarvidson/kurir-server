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
