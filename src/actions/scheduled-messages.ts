"use server";

import { updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";
import {
  recipientField,
  createScheduledMessageForUser,
  cancelScheduledForUser,
  sendScheduledNowForUser,
  type CreateScheduledInput,
} from "@/lib/mail/scheduled-messages";

const editSchema = z.object({
  to: recipientField.optional(),
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  scheduledFor: z
    .string()
    .transform((s) => {
      const date = new Date(s);
      if (isNaN(date.getTime())) throw new Error("Invalid date");
      if (date <= new Date())
        throw new Error("scheduledFor must be in the future");
      return date;
    })
    .optional(),
  emailConnectionId: z.string().optional(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export async function createScheduledMessage(data: CreateScheduledInput) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { id } = await createScheduledMessageForUser(session.user.id, data);
  return { id };
}

export async function cancelScheduledMessage(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const result = await cancelScheduledForUser(session.user.id, id);
  if (result === "not_found") throw new Error("Scheduled message not found");
  if (result === "not_pending")
    throw new Error("Only PENDING messages can be cancelled");
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
  data: z.input<typeof editSchema>,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const parsed = editSchema.parse(data);

  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId },
  });
  if (!msg) throw new Error("Scheduled message not found");
  if (msg.status !== "PENDING")
    throw new Error("Only PENDING messages can be edited");

  // If connection changed, verify the new one belongs to user
  if (
    parsed.emailConnectionId &&
    parsed.emailConnectionId !== msg.emailConnectionId
  ) {
    const connection = await db.emailConnection.findFirst({
      where: { id: parsed.emailConnectionId, userId },
    });
    if (!connection) throw new Error("Email connection not found");
  }

  // Build update payload, encrypting body fields if provided
  const updateData: Record<string, unknown> = {};
  if (parsed.to !== undefined) updateData.to = parsed.to;
  if (parsed.subject !== undefined) updateData.subject = parsed.subject;
  if (parsed.textBody !== undefined)
    updateData.textBody = encrypt(parsed.textBody);
  if (parsed.htmlBody !== undefined)
    updateData.htmlBody = encrypt(parsed.htmlBody);
  if (parsed.scheduledFor !== undefined) {
    const jitterMs = (1 + Math.random() * 13) * 60_000;
    updateData.scheduledFor = new Date(
      parsed.scheduledFor.getTime() + jitterMs,
    );
  }
  if (parsed.emailConnectionId !== undefined)
    updateData.emailConnectionId = parsed.emailConnectionId;
  if (parsed.inReplyToMessageId !== undefined)
    updateData.inReplyToMessageId = parsed.inReplyToMessageId;
  if (parsed.references !== undefined)
    updateData.references = parsed.references;
  if (parsed.attachmentIds !== undefined)
    updateData.attachmentIds = parsed.attachmentIds;

  await db.scheduledMessage.update({
    where: { id },
    data: updateData,
  });

  updateTag("sidebar-counts");
}

export async function sendScheduledMessageNow(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await sendScheduledNowForUser(session.user.id, id);
}
