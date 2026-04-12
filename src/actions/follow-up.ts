"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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

function revalidateFollowUpPaths() {
  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/sent");
  revalidatePath("/archive");
  revalidatePath("/follow-up");
}

export async function setFollowUp(messageId: string, until: Date) {
  if (until <= new Date()) {
    throw new Error("Follow-up date must be in the future");
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      followUpAt: until,
      followUpSetAt: new Date(),
      isFollowUp: false,
    },
  });

  revalidateFollowUpPaths();
}

export async function dismissFollowUp(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      followUpAt: null,
      followUpSetAt: null,
      isFollowUp: false,
    },
  });

  revalidateFollowUpPaths();
}

export async function extendFollowUp(messageId: string, until: Date) {
  if (until <= new Date()) {
    throw new Error("Follow-up date must be in the future");
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      followUpAt: until,
      followUpSetAt: new Date(),
      isFollowUp: false,
    },
  });

  revalidateFollowUpPaths();
}

export async function cancelFollowUp(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const messageIds = await getThreadMessageIds(session.user.id, messageId);

  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      followUpAt: null,
      followUpSetAt: null,
      isFollowUp: false,
    },
  });

  revalidateFollowUpPaths();
}
