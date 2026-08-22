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
