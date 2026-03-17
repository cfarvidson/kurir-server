"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { moveToArchiveViaImap } from "@/actions/archive";
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

  const userId = session.user.id;

  // Verify ownership + get emailConnectionId for IMAP move
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, emailConnectionId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  // Fetch inbox UIDs for IMAP move (parallelize independent queries)
  const [inboxMessages, inboxFolder] = await Promise.all([
    db.message.findMany({
      where: { senderId, isArchived: false, uid: { gt: 0 } },
      select: { uid: true, folderId: true },
    }),
    db.folder.findFirst({
      where: {
        emailConnectionId: sender.emailConnectionId,
        specialUse: "inbox",
      },
      select: { id: true },
    }),
  ]);

  const inboxUids = inboxFolder
    ? inboxMessages
        .filter((m) => m.folderId === inboxFolder.id)
        .map((m) => m.uid)
    : [];

  // Reject sender + archive messages (instead of limbo)
  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
      },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: true,
        isSnoozed: false,
        snoozedUntil: null,
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");

  // Defer IMAP move to after response
  if (inboxUids.length > 0 && inboxFolder) {
    after(() =>
      moveToArchiveViaImap(
        userId,
        sender.emailConnectionId,
        inboxFolder.id,
        inboxUids
      ).catch((err) =>
        console.error("IMAP archive move (reject) failed:", err)
      )
    );
  }
}

export async function skipSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== session.user.id) {
    throw new Error("Sender not found");
  }

  // Hide from Screener for 24 hours
  await db.sender.update({
    where: { id: senderId },
    data: { skippedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  revalidateTag("sidebar-counts");
  revalidatePath("/screener");
}

/**
 * Auto-approve all PENDING senders whose most recent message is older
 * than `days` days. Approved into IMBOX by default. Returns the count
 * of senders approved.
 */
export async function bulkApproveOldSenders(days: number = 90) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Find PENDING senders who have messages, but NONE within the last N days
  const oldSenders = await db.sender.findMany({
    where: {
      userId,
      status: "PENDING",
      messages: {
        some: {},
        none: { receivedAt: { gte: cutoff } },
      },
    },
    select: { id: true },
  });

  if (oldSenders.length === 0) return 0;

  const senderIds = oldSenders.map((s) => s.id);

  await db.$transaction([
    db.sender.updateMany({
      where: { id: { in: senderIds } },
      data: {
        status: "APPROVED",
        category: "IMBOX",
        decidedAt: new Date(),
      },
    }),
    db.message.updateMany({
      where: { senderId: { in: senderIds }, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: true,
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");

  return oldSenders.length;
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
