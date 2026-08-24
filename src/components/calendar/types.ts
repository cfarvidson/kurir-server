export type CalendarViewMode = "week" | "day" | "month";

export type CalendarInstanceDTO = {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  isException: boolean;
  calendarId: string;
  color: string;
  calendarName: string;
  transparency: "busy" | "free";
  location: string | null;
  description: string | null;
  rrule: string | null;
  isReadOnly: boolean;
};

export type CalendarListItem = {
  id: string;
  name: string;
  color: string | null;
  isVisible: boolean;
  isReadOnly: boolean;
  isPrimary: boolean;
  /** Why this calendar's own pull last failed. Account errors live on the account. */
  lastError: string | null;
};

export type CalendarAccountDTO = {
  id: string;
  displayName: string;
  provider: "GOOGLE" | "MICROSOFT" | "CALDAV" | "ICS";
  oauthError: string | null;
  lastError: string | null;
  calendars: CalendarListItem[];
};

export type SlotSelection = {
  date: string;
  startMin: number;
  endMin: number;
  allDay: boolean;
};
