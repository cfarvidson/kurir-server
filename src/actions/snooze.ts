"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { snoozeThread, unsnoozeThread } from "@/lib/mail/mutations";

export async function snoozeConversation(messageId: string, until: Date) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await snoozeThread(session.user.id, messageId, until);

  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/snoozed");
}

export async function unsnoozeConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await unsnoozeThread(session.user.id, messageId);

  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/snoozed");
}

export async function snoozeConversations(messageIds: string[], until: Date) {
  if (until <= new Date()) {
    throw new Error("Snooze date must be in the future");
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Find all target messages and their threadIds
  const messages = await db.message.findMany({
    where: { id: { in: messageIds }, userId },
    select: { id: true, threadId: true },
  });

  if (messages.length === 0) return;

  // Collect all thread messages across all selected threads
  const threadIds = [
    ...new Set(
      messages.map((m) => m.threadId).filter((id): id is string => id !== null),
    ),
  ];
  const singleIds = messages.filter((m) => !m.threadId).map((m) => m.id);

  const threadMessages = await db.message.findMany({
    where: {
      userId,
      OR: [
        ...(threadIds.length > 0 ? [{ threadId: { in: threadIds } }] : []),
        ...(singleIds.length > 0 ? [{ id: { in: singleIds } }] : []),
      ],
    },
    select: { id: true },
  });

  const allMessageIds = threadMessages.map((m) => m.id);

  // Leave read state untouched (see snoozeConversation).
  await db.message.updateMany({
    where: { id: { in: allMessageIds } },
    data: {
      isSnoozed: true,
      snoozedUntil: until,
    },
  });

  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/snoozed");
}
