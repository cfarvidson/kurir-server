export type RecurrenceEdit = "this" | "thisAndFollowing" | "all";

export type RemoteCalendar = {
  providerCalendarId: string;
  name: string;
  color: string | null;
  isPrimary: boolean;
  isReadOnly: boolean;
  timezone: string | null;
};

export type RemoteEvent = {
  providerEventId: string;
  icalUid: string | null;
  etag: string | null;
  sequence: number;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  transparency: "busy" | "free";
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  masterProviderEventId: string | null;
  recurrenceId: Date | null;
  organizerJson: unknown;
  attendeesJson: unknown;
  rawJson: unknown;
};

export type EventAttendeeInput = {
  email: string;
  name?: string | null;
  status?: "accepted" | "tentative" | "declined" | "needsAction";
  self?: boolean;
};

export type EventOrganizerInput = {
  email: string;
  name?: string | null;
};

export type EventInput = {
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  icalUid?: string | null;
  organizer?: EventOrganizerInput | null;
  attendees?: EventAttendeeInput[] | null;
};

export type PullResult = {
  upserts: RemoteEvent[];
  deletedProviderIds: string[];
  cursor: string | null;
  reset: boolean;
  complete: boolean;
};

export interface CalendarAdapter {
  listCalendars(): Promise<RemoteCalendar[]>;
  pull(
    calendar: { providerCalendarId: string; syncToken: string | null },
    cursor: string | null,
  ): Promise<PullResult>;
  createEvent(
    calendar: { providerCalendarId: string },
    input: EventInput,
  ): Promise<RemoteEvent>;
  getEvent(
    calendar: { providerCalendarId: string },
    providerEventId: string,
  ): Promise<RemoteEvent>;
  moveEvent(
    from: { providerCalendarId: string },
    to: { providerCalendarId: string },
    event: { providerEventId: string; etag: string | null },
  ): Promise<RemoteEvent>;
  updateEvent(
    calendar: { providerCalendarId: string },
    event: {
      providerEventId: string;
      etag: string | null;
      recurrenceId: Date | null;
    },
    input: EventInput,
    range: RecurrenceEdit,
  ): Promise<RemoteEvent>;
  deleteEvent(
    calendar: { providerCalendarId: string },
    event: {
      providerEventId: string;
      etag: string | null;
      recurrenceId: Date | null;
    },
    range: RecurrenceEdit,
  ): Promise<void>;
  respond(
    calendar: { providerCalendarId: string },
    event: { providerEventId: string },
    status: "accepted" | "tentative" | "declined",
  ): Promise<RemoteEvent>;
}

export class CalendarConflictError extends Error {
  constructor(readonly providerLabel: string) {
    super(`This event changed on ${providerLabel}.`);
    this.name = "CalendarConflictError";
  }
}
