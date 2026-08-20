import { Prisma, type CalendarProvider } from "@prisma/client";
import { getConnectionCredentials } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import { sendItipReply } from "@/lib/calendar/itip";
import { createCalDavAdapter } from "@/lib/calendar/providers/caldav";
import { createGoogleAdapter } from "@/lib/calendar/providers/google";
import { createMicrosoftAdapter } from "@/lib/calendar/providers/microsoft";
import type {
  CalendarAdapter,
  EventInput,
  RecurrenceEdit,
  RemoteEvent,
} from "@/lib/calendar/providers/types";
import {
  resolveRsvpCalendar,
  rsvpSendsItip,
  type CalendarProviderKind,
} from "@/lib/calendar/rsvp-route";
import {
  CalendarWriteError,
  createEventForUser,
} from "@/lib/calendar/write";

export type RsvpStatus = "accepted" | "tentative" | "declined";

const PARTSTAT: Record<RsvpStatus, string> = {
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

type AccountCreds = {
  id: string;
  provider: CalendarProvider;
  principalEmail: string | null;
  oauthAccessToken: string | null;
  caldavUrl: string | null;
  caldavUsername: string | null;
  encryptedPassword: string | null;
};

type CalendarWithAccount = {
  id: string;
  isReadOnly: boolean;
  isPrimary: boolean;
  isVisible: boolean;
  providerCalendarId: string;
  account: AccountCreds;
};

type MeetingRow = {
  id: string;
  uid: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isAllDay: boolean;
  location: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  recurrenceId: Date | null;
  calendarEventId: string | null;
  message: {
    emailConnectionId: string;
    emailConnection: {
      email: string;
      aliases: string[];
      sendAsEmail: string | null;
    };
  };
};

type EventWithCalendar = {
  id: string;
  providerEventId: string;
  icalUid: string | null;
  sequence: number;
  calendarId: string;
  calendar: CalendarWithAccount;
};

function asJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function rsvpRange(recurrenceId: Date | null): RecurrenceEdit {
  return recurrenceId ? "this" : "all";
}

function adapterForAccount(account: AccountCreds): CalendarAdapter {
  if (account.provider === "GOOGLE") {
    if (!account.oauthAccessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createGoogleAdapter({
      accessToken: decrypt(account.oauthAccessToken),
    });
  }
  if (account.provider === "MICROSOFT") {
    if (!account.oauthAccessToken) {
      throw new CalendarWriteError("Missing OAuth token", 500);
    }
    return createMicrosoftAdapter({
      accessToken: decrypt(account.oauthAccessToken),
    });
  }
  if (!account.caldavUrl || !account.caldavUsername || !account.encryptedPassword) {
    throw new CalendarWriteError("Missing CalDAV credentials", 500);
  }
  return createCalDavAdapter({
    url: account.caldavUrl,
    username: account.caldavUsername,
    password: decrypt(account.encryptedPassword),
  });
}

function eventInputFromMeeting(meeting: MeetingRow): EventInput {
  if (!meeting.startAt || !meeting.endAt) {
    throw new Error("Meeting is missing start or end time");
  }
  return {
    title: meeting.title,
    description: null,
    location: meeting.location,
    startAt: meeting.startAt,
    endAt: meeting.endAt,
    isAllDay: meeting.isAllDay,
    timezone: null,
    rrule: null,
  };
}

function attendeeEmail(meeting: MeetingRow): string {
  return meeting.message.emailConnection.sendAsEmail || meeting.message.emailConnection.email;
}

function replicaAttendees(email: string, status: RsvpStatus) {
  return [{ email, partstat: PARTSTAT[status], self: true }];
}

const eventInclude = {
  calendar: {
    include: {
      account: {
        select: {
          id: true,
          provider: true,
          principalEmail: true,
          oauthAccessToken: true,
          caldavUrl: true,
          caldavUsername: true,
          encryptedPassword: true,
        },
      },
    },
  },
} as const;

async function loadEventForMeeting(
  userId: string,
  meeting: MeetingRow,
): Promise<EventWithCalendar | null> {
  const include = eventInclude;
  if (meeting.recurrenceId) {
    const exception = await db.calendarEvent.findFirst({
      where: {
        userId,
        icalUid: meeting.uid,
        recurrenceId: meeting.recurrenceId,
      },
      include,
    });
    if (exception?.calendar?.account) return exception as unknown as EventWithCalendar;
  }
  if (meeting.calendarEventId) {
    const linked = await db.calendarEvent.findFirst({
      where: { id: meeting.calendarEventId, userId },
      include,
    });
    if (linked?.calendar?.account) return linked as unknown as EventWithCalendar;
  }
  const byUid = await db.calendarEvent.findFirst({
    where: { userId, icalUid: meeting.uid },
    include,
  });
  if (byUid?.calendar?.account) return byUid as unknown as EventWithCalendar;
  return null;
}

async function persistRespond(
  event: EventWithCalendar,
  remote: RemoteEvent,
): Promise<void> {
  await db.calendarEvent.update({
    where: { id: event.id },
    data: {
      providerEventId: remote.providerEventId,
      icalUid: remote.icalUid ?? event.icalUid,
      etag: remote.etag,
      sequence: remote.sequence,
      status: remote.status,
      attendeesJson: asJson(remote.attendeesJson),
      organizerJson: asJson(remote.organizerJson),
      rawJson: asJson(remote.rawJson),
    },
  });
}

async function linkMeeting(meetingId: string, eventId: string): Promise<void> {
  await db.messageMeeting.update({
    where: { id: meetingId },
    data: { calendarEventId: eventId },
  });
}

async function createReplicaEvent(
  userId: string,
  calendar: CalendarWithAccount,
  meeting: MeetingRow,
  status: RsvpStatus,
): Promise<{ id: string }> {
  const input = eventInputFromMeeting(meeting);
  const row = await db.calendarEvent.create({
    data: {
      providerEventId: `demo:${crypto.randomUUID()}`,
      icalUid: meeting.uid,
      etag: null,
      sequence: 0,
      ...input,
      status: status === "tentative" ? "tentative" : "confirmed",
      transparency: "busy",
      rdate: null,
      exdate: null,
      masterEventId: null,
      recurrenceId: meeting.recurrenceId,
      organizerJson: meeting.organizerEmail
        ? { email: meeting.organizerEmail, cn: meeting.organizerName }
        : Prisma.DbNull,
      attendeesJson: replicaAttendees(attendeeEmail(meeting), status),
      rawJson: Prisma.DbNull,
      calendarId: calendar.id,
      userId,
    },
  });
  return { id: row.id };
}

async function updateReplicaRsvp(
  eventId: string,
  meeting: MeetingRow,
  status: RsvpStatus,
): Promise<void> {
  await db.calendarEvent.update({
    where: { id: eventId },
    data: {
      status: status === "tentative" ? "tentative" : "confirmed",
      attendeesJson: replicaAttendees(attendeeEmail(meeting), status),
    },
  });
}

async function sendCalDavItip(
  userId: string,
  meeting: MeetingRow,
  status: RsvpStatus,
  sequence: number,
): Promise<void> {
  if (!meeting.organizerEmail) return;
  const credentials = await getConnectionCredentials(
    meeting.message.emailConnectionId,
    userId,
  );
  if (!credentials) {
    throw new Error("Email credentials not found");
  }
  const range = rsvpRange(meeting.recurrenceId);
  await sendItipReply(credentials, {
    uid: meeting.uid,
    title: meeting.title,
    startAt: meeting.startAt,
    endAt: meeting.endAt,
    isAllDay: meeting.isAllDay,
    organizerEmail: meeting.organizerEmail,
    organizerName: meeting.organizerName,
    attendeeEmail: attendeeEmail(meeting),
    status,
    recurrenceId: range === "this" ? meeting.recurrenceId : null,
    sequence,
  });
}

export async function rsvpToMeetingForUser(
  userId: string,
  messageId: string,
  status: RsvpStatus,
  calendarId?: string,
): Promise<void> {
  const meeting = (await db.messageMeeting.findFirst({
    where: { userId, messageId },
    include: {
      message: {
        select: {
          emailConnectionId: true,
          emailConnection: {
            select: { email: true, aliases: true, sendAsEmail: true },
          },
        },
      },
    },
  })) as MeetingRow | null;
  if (!meeting?.message?.emailConnection) {
    throw new Error("Meeting not found");
  }

  const calendars = (await db.calendar.findMany({
    where: { userId },
    select: {
      id: true,
      isReadOnly: true,
      isPrimary: true,
      isVisible: true,
      providerCalendarId: true,
      account: {
        select: {
          id: true,
          provider: true,
          principalEmail: true,
          oauthAccessToken: true,
          caldavUrl: true,
          caldavUsername: true,
          encryptedPassword: true,
        },
      },
    },
  })) as CalendarWithAccount[];

  const resolvedId = resolveRsvpCalendar(
    calendars.map((calendar) => ({
      id: calendar.id,
      isReadOnly: calendar.isReadOnly,
      isPrimary: calendar.isPrimary,
      isVisible: calendar.isVisible,
      principalEmail: calendar.account?.principalEmail ?? null,
    })),
    meeting.message.emailConnection.email,
    meeting.message.emailConnection.aliases ?? [],
    calendarId,
  );
  if (!resolvedId) {
    throw new Error("Connect a calendar to reply.");
  }
  const resolved = calendars.find((calendar) => calendar.id === resolvedId);
  if (!resolved?.account) {
    throw new Error("Connect a calendar to reply.");
  }

  let event = await loadEventForMeeting(userId, meeting);

  if (isDemoInstance()) {
    if (!event) {
      const created = await createReplicaEvent(userId, resolved, meeting, status);
      await linkMeeting(meeting.id, created.id);
      return;
    }
    await updateReplicaRsvp(event.id, meeting, status);
    await linkMeeting(meeting.id, event.id);
    return;
  }

  if (!event) {
    const created = await createEventForUser(
      userId,
      resolved.id,
      eventInputFromMeeting(meeting),
    );
    const loaded = await db.calendarEvent.findFirst({
      where: { id: created.id, userId },
      include: eventInclude,
    });
    if (!loaded?.calendar?.account) {
      throw new Error("Created calendar event is missing");
    }
    event = loaded as unknown as EventWithCalendar;
  }

  const calendar = event.calendar;
  const adapter = adapterForAccount(calendar.account);
  const remote = await adapter.respond(
    { providerCalendarId: calendar.providerCalendarId },
    { providerEventId: event.providerEventId },
    status,
  );
  await persistRespond(event, remote);
  await linkMeeting(meeting.id, event.id);

  const provider = calendar.account.provider as CalendarProviderKind;
  if (rsvpSendsItip(provider)) {
    await sendCalDavItip(userId, meeting, status, remote.sequence ?? event.sequence);
  }
}
