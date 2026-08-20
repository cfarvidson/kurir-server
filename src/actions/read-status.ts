"use server";

import { updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { setThreadReadState } from "@/lib/mail/mutations";

export async function toggleReadStatus(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, isRead: true },
  });

  if (!message) throw new Error("Message not found");

  const newStatus = !message.isRead;

  await setThreadReadState(userId, messageId, newStatus);

  updateTag("sidebar-counts");

  return { isRead: newStatus };
}

export async function setConversationsRead(
  messageIds: string[],
  isRead: boolean,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const uniqueIds = [...new Set(messageIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  for (const id of uniqueIds) {
    await setThreadReadState(userId, id, isRead);
  }

  updateTag("sidebar-counts");
}
