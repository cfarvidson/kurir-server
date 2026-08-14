"use server";

import { updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createScheduledMessageForUser,
  cancelScheduledForUser,
  sendScheduledNowForUser,
  deferScheduledForUser,
  restoreScheduledTimeForUser,
  updateScheduledForUser,
  type CreateScheduledInput,
  type UpdateScheduledInput,
} from "@/lib/mail/scheduled-messages";

export async function createScheduledMessage(data: CreateScheduledInput) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { id } = await createScheduledMessageForUser(session.user.id, data);
  updateTag("sidebar-counts");
  return { id };
}

export async function cancelScheduledMessage(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const result = await cancelScheduledForUser(session.user.id, id);
  if (result === "not_found") throw new Error("Scheduled message not found");
  if (result === "not_pending")
    throw new Error("Only PENDING messages can be cancelled");
  updateTag("sidebar-counts");
}

/**
 * Atomically "hold" a scheduled message when the user sends it now from the
 * edit screen. Flips PENDING → CANCELLED in a single compare-and-set so the
 * background scheduler (`sendDueScheduledMessages`) can never also deliver the
 * copy — closing the double-send race (issue #52).
 *
 * Returns `{ held: false }` (rather than throwing) when the row is no longer
 * PENDING: that means the scheduler already claimed/sent it, and the caller
 * must NOT also send. Pair with `restoreScheduledMessage` to undo the hold.
 */
export async function holdScheduledMessage(
  id: string,
): Promise<{ held: boolean }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const result = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  const held = result.count === 1;
  if (held) updateTag("sidebar-counts");

  return { held };
}

/**
 * Reverse a `holdScheduledMessage` when the user hits Undo within the send
 * window. Flips CANCELLED → PENDING atomically, restoring the schedule with
 * its *original* content (the send-now path never persists in-progress compose
 * edits onto the row — only the explicit "Update schedule" action does).
 *
 * Returns `{ restored: false }` (no throw) when the row isn't in a restorable
 * state, e.g. it was already delivered.
 */
export async function restoreScheduledMessage(
  id: string,
): Promise<{ restored: boolean }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const result = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "CANCELLED" },
    data: { status: "PENDING" },
  });

  const restored = result.count === 1;
  if (restored) updateTag("sidebar-counts");

  return { restored };
}

export async function editScheduledMessage(
  id: string,
  data: UpdateScheduledInput,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await updateScheduledForUser(session.user.id, id, data);
  updateTag("sidebar-counts");
}

export async function deferScheduledMessage(id: string, deferMs: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return deferScheduledForUser(session.user.id, id, deferMs);
}

export async function restoreScheduledTime(id: string, scheduledFor: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const date = new Date(scheduledFor);
  if (isNaN(date.getTime())) throw new Error("Invalid date");
  const restored = await restoreScheduledTimeForUser(session.user.id, id, date);
  return { restored };
}

export async function sendScheduledMessageNow(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await sendScheduledNowForUser(session.user.id, id);
  updateTag("sidebar-counts");
}
