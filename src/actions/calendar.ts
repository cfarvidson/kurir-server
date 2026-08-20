"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createCalDavAccount,
  deleteCalendarAccount,
  setCalendarVisibleForUser,
} from "@/lib/calendar/accounts";
import { enqueueCalendarSyncJob } from "@/lib/jobs/calendar-sync-worker";

function revalidateCalendar() {
  revalidatePath("/settings");
  revalidatePath("/calendar");
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
