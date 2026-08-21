"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createCalDavAccount,
  deleteCalendarAccount,
  setCalendarVisibleForUser,
} from "@/lib/calendar/accounts";
import type {
  EventInput,
  RecurrenceEdit,
} from "@/lib/calendar/providers/types";
import { rsvpToMeetingForUser, type RsvpStatus } from "@/lib/calendar/rsvp";
import {
  createEventForUser,
  deleteEventForUser,
  updateEventForUser,
} from "@/lib/calendar/write";
import { enqueueCalendarSyncJob } from "@/lib/jobs/calendar-sync-worker";

function revalidateCalendar() {
  revalidatePath("/settings");
  revalidatePath("/calendar");
  revalidatePath("/calendar/day");
  revalidatePath("/calendar/month");
}

function coerceEventInput(input: EventInput): EventInput {
  return {
    ...input,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
  };
}

export async function connectCalDavAction(input: {
  url: string;
  username: string;
  password: string;
}) {
  const session = await requireAuth();
  const account = await createCalDavAccount({
    userId: session.user.id,
    url: input.url,
    username: input.username,
    password: input.password,
  });
  revalidateCalendar();
  return account;
}

export async function disconnectCalendarAccountAction(accountId: string) {
  const session = await requireAuth();
  await deleteCalendarAccount(session.user.id, accountId);
  revalidateCalendar();
}

export async function syncCalendarNowAction(accountId: string) {
  const session = await requireAuth();
  const account = await db.calendarAccount.findFirst({
    where: { id: accountId, userId: session.user.id },
    select: { id: true, userId: true },
  });
  if (!account) throw new Error("Calendar account not found");
  await enqueueCalendarSyncJob(account.id, account.userId, { immediate: true });
  revalidateCalendar();
}

export async function setCalendarVisibleAction(
  calendarId: string,
  isVisible: boolean,
) {
  const session = await requireAuth();
  await setCalendarVisibleForUser(session.user.id, calendarId, isVisible);
  revalidateCalendar();
}

export async function createEventAction(calendarId: string, input: EventInput) {
  const session = await requireAuth();
  const created = await createEventForUser(
    session.user.id,
    calendarId,
    coerceEventInput(input),
  );
  revalidateCalendar();
  return created;
}

export async function updateEventAction(
  eventId: string,
  input: EventInput & { calendarId?: string },
  range: RecurrenceEdit,
) {
  const session = await requireAuth();
  await updateEventForUser(
    session.user.id,
    eventId,
    { ...coerceEventInput(input), calendarId: input.calendarId },
    range,
  );
  revalidateCalendar();
}

export async function deleteEventAction(eventId: string, range: RecurrenceEdit) {
  const session = await requireAuth();
  await deleteEventForUser(session.user.id, eventId, range);
  revalidateCalendar();
}

export async function rsvpAction(
  messageId: string,
  status: RsvpStatus,
  calendarId?: string,
) {
  const session = await requireAuth();
  await rsvpToMeetingForUser(session.user.id, messageId, status, calendarId);
  revalidateCalendar();
}
