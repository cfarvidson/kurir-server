"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Resolve every message id in the same thread as `messageId` (scoped to the
 * user). Mirrors the thread fan-out used by follow-up actions so the flag
 * applies to the whole conversation.
 */
async function getThreadMessageIds(userId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  return threadMessages.map((m) => m.id);
}

function revalidateReplyLaterPaths() {
  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/sent");
  revalidatePath("/archive");
  revalidatePath("/reply-later");
}

/** Flag a thread for Reply Later. */
export async function setReplyLater(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: { isReplyLater: true },
  });

  revalidateReplyLaterPaths();
}

/** Remove a thread from Reply Later (replied or dismissed). */
export async function clearReplyLater(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: { isReplyLater: false },
  });

  revalidateReplyLaterPaths();
}
