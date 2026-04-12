"use server";

import { updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function toggleReadStatus(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true, isRead: true },
  });

  if (!message) throw new Error("Message not found");

  const newStatus = !message.isRead;

  // Apply to entire thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  const messageIds = threadMessages.map((m) => m.id);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: { isRead: newStatus },
  });

  updateTag("sidebar-counts");

  return { isRead: newStatus };
}
