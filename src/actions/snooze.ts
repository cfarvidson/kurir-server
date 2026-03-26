"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function snoozeConversation(messageId: string, until: Date) {
  if (until <= new Date()) {
    throw new Error("Snooze date must be in the future");
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Find the target message and its threadId
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  // Find all messages in this thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  const messageIds = threadMessages.map((m) => m.id);

  // Snooze all thread messages; mark read (user acknowledged, just deferred)
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isSnoozed: true,
      snoozedUntil: until,
      isRead: true,
    },
  });

  revalidateTag("sidebar-counts");
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

  const userId = session.user.id;

  // Find the target message and its threadId
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  // Find all messages in this thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  const messageIds = threadMessages.map((m) => m.id);

  // Unsnooze: mark unread so it resurfaces in "New For You"
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isSnoozed: false,
      snoozedUntil: null,
      isRead: false,
    },
  });

  revalidateTag("sidebar-counts");
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
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
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

  await db.message.updateMany({
    where: { id: { in: allMessageIds } },
    data: {
      isSnoozed: true,
      snoozedUntil: until,
      isRead: true,
    },
  });

  revalidateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/snoozed");
}
