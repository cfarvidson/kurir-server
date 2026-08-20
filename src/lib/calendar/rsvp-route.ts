export type CalendarProviderKind = "GOOGLE" | "MICROSOFT" | "CALDAV";

export function rsvpSendsItip(provider: CalendarProviderKind): boolean {
  return provider === "CALDAV";
}

export type RsvpCalendarCandidate = {
  id: string;
  isReadOnly: boolean;
  isPrimary: boolean;
  isVisible: boolean;
  principalEmail: string | null;
};

function emailsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function resolveRsvpCalendar(
  calendars: RsvpCalendarCandidate[],
  messageAccountEmail: string,
  aliases: string[],
  explicitCalendarId?: string,
): string | null {
  if (explicitCalendarId !== undefined) {
    const row = calendars.find((c) => c.id === explicitCalendarId);
    if (row && !row.isReadOnly) return row.id;
    return null;
  }

  const matchesPrincipal = (email: string | null): boolean => {
    if (!email) return false;
    if (emailsMatch(email, messageAccountEmail)) return true;
    return aliases.some((alias) => emailsMatch(email, alias));
  };

  const onPrincipal = calendars.find(
    (c) => matchesPrincipal(c.principalEmail) && c.isPrimary && !c.isReadOnly,
  );
  if (onPrincipal) return onPrincipal.id;

  const fallback = calendars.find((c) => !c.isReadOnly && c.isVisible);
  return fallback?.id ?? null;
}
