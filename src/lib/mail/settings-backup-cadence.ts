export type SettingsBackupCadence = "off" | "daily" | "weekly";

export const SETTINGS_BACKUP_HOUR = 3;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: string;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday"),
  };
}

function addCalendarDays(
  parts: Pick<ZonedParts, "year" | "month" | "day">,
  days: number,
): { year: number; month: number; day: number } {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const d = new Date(utc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Iterates once to correct the UTC offset (DST-safe for whole hours).
 */
export function zonedWallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  const asZone = zonedParts(new Date(desired), timeZone);
  const actual = Date.UTC(asZone.year, asZone.month - 1, asZone.day, asZone.hour);
  const adjusted = new Date(desired + (desired - actual));
  const check = zonedParts(adjusted, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour
  ) {
    const second = Date.UTC(check.year, check.month - 1, check.day, check.hour);
    return new Date(adjusted.getTime() + (desired - second));
  }
  return adjusted;
}

export function computeNextRunAt(opts: {
  now: Date;
  timezone: string;
  cadence: SettingsBackupCadence;
}): Date | null {
  if (opts.cadence === "off") return null;

  const parts = zonedParts(opts.now, opts.timezone);
  let target = zonedWallTimeToUtc(
    opts.timezone,
    parts.year,
    parts.month,
    parts.day,
    SETTINGS_BACKUP_HOUR,
  );

  if (target.getTime() <= opts.now.getTime()) {
    const days = opts.cadence === "weekly" ? 7 : 1;
    const next = addCalendarDays(parts, days);
    target = zonedWallTimeToUtc(
      opts.timezone,
      next.year,
      next.month,
      next.day,
      SETTINGS_BACKUP_HOUR,
    );
  }

  return target;
}

export function advanceRunAt(opts: {
  slot: Date;
  timezone: string;
  cadence: Exclude<SettingsBackupCadence, "off">;
}): Date {
  const parts = zonedParts(opts.slot, opts.timezone);
  const days = opts.cadence === "weekly" ? 7 : 1;
  const next = addCalendarDays(parts, days);
  return zonedWallTimeToUtc(
    opts.timezone,
    next.year,
    next.month,
    next.day,
    SETTINGS_BACKUP_HOUR,
  );
}

export function isSettingsBackupCadence(
  value: string,
): value is SettingsBackupCadence {
  return value === "off" || value === "daily" || value === "weekly";
}
