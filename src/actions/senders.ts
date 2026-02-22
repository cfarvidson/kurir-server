"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { SenderCategory } from "@prisma/client";

export async function approveSender(senderId: string, category: SenderCategory) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== session.user.id) {
    throw new Error("Sender not found");
  }

  // Update sender status
  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "APPROVED",
        category,
        decidedAt: new Date(),
      },
    }),
    // Move non-archived messages from this sender to the appropriate location
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/screener");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}

export async function rejectSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== session.user.id) {
    throw new Error("Sender not found");
  }

  // Update sender status - messages stay hidden
  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
      },
    }),
    // Remove non-archived messages from screener but don't show them anywhere
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}

export async function changeSenderCategory(
  senderId: string,
  category: SenderCategory
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, status: true },
  });

  if (!sender || sender.userId !== session.user.id) {
    throw new Error("Sender not found");
  }

  if (sender.status !== "APPROVED") {
    throw new Error("Sender must be approved first");
  }

  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: { category },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}
