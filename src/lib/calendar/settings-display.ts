export type CalendarProviderId = "GOOGLE" | "MICROSOFT" | "CALDAV" | "ICS";

const SETTINGS_CALENDAR_TAB = "/settings?tab=calendar";

export function calendarProviderLabel(provider: CalendarProviderId): string {
  if (provider === "GOOGLE") return "Google";
  if (provider === "MICROSOFT") return "Outlook";
  if (provider === "ICS") return "Calendar URL";
  return "CalDAV";
}

export function calendarReconnectHref(
  provider: CalendarProviderId,
): string | null {
  if (provider === "CALDAV" || provider === "ICS") return null;
  const slug = provider === "GOOGLE" ? "google" : "microsoft";
  return `/api/calendar/oauth/start?provider=${slug}&redirect=${encodeURIComponent(SETTINGS_CALENDAR_TAB)}`;
}

export function calendarLastSyncLabel(
  lastSyncedAt: string | null,
  isSyncing: boolean,
): string {
  if (isSyncing) return "Syncing...";
  if (!lastSyncedAt) return "Not yet synced";
  return `Last synced ${new Date(lastSyncedAt).toLocaleString()}`;
}
