"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  approveSenderForUser,
  rejectSenderForUser,
  skipSenderForUser,
  unskipSenderForUser,
  undoScreenActionForUser,
  changeSenderCategoryForUser,
  setSenderUnthreadForUser,
  bulkApproveOldSendersForUser,
} from "@/lib/mail/mutations";
import { getOwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";
import { SenderCategory } from "@prisma/client";

export type RejectSendersResult =
  | { needsConfirm: true; count: number }
  | { rejectedIds: string[] };

export async function approveSender(
  senderId: string,
  category: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await approveSenderForUser(session.user.id, senderId, category);

  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/screener");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/contacts");
}

export async function rejectSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await rejectSenderForUser(session.user.id, senderId);

  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}

export async function rejectSenders(
  senderIds: string[],
  options?: { confirmed?: boolean },
): Promise<RejectSendersResult> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of senderIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
  }
  if (uniqueIds.length === 0) return { rejectedIds: [] };

  const [own, senders] = await Promise.all([
    getOwnAddresses(userId),
    db.sender.findMany({
      where: { id: { in: uniqueIds }, userId },
      select: {
        id: true,
        email: true,
        _count: { select: { messages: true } },
      },
    }),
  ]);

  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const blockable = uniqueIds
    .map((id) => byId.get(id))
    .filter(
      (sender): sender is NonNullable<typeof sender> =>
        !!sender && !isOwnAddress(sender.email, own),
    );
  if (blockable.length === 0) return { rejectedIds: [] };

  if (
    blockable.length === 1 &&
    !options?.confirmed &&
    blockable[0]._count.messages >= 10
  ) {
    return { needsConfirm: true, count: blockable[0]._count.messages };
  }

  const rejectedIds: string[] = [];
  for (const sender of blockable) {
    await rejectSenderForUser(userId, sender.id);
    rejectedIds.push(sender.id);
  }

  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  return { rejectedIds };
}

export async function skipSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await skipSenderForUser(session.user.id, senderId);

  updateTag("sidebar-counts");
  revalidatePath("/screener");
}

/**
 * Undo a screen-in or screen-out action by reverting the sender to PENDING
 * and moving their messages back into the screener.
 */
export async function undoScreenAction(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await undoScreenActionForUser(session.user.id, senderId);

  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
}

export async function unskipSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await unskipSenderForUser(session.user.id, senderId);

  updateTag("sidebar-counts");
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

  const approved = await bulkApproveOldSendersForUser(session.user.id, days);

  updateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/imbox");

  return approved;
}

export async function changeSenderCategory(
  senderId: string,
  category: SenderCategory,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await changeSenderCategoryForUser(session.user.id, senderId, category);

  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}

/**
 * Toggle whether messages from a sender are grouped into threads in list and
 * detail views. When `unthread` is true, each message renders as its own row
 * and the detail view shows only the single message.
 */
export async function setSenderUnthread(senderId: string, unthread: boolean) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await setSenderUnthreadForUser(session.user.id, senderId, unthread);

  // Unthread does not change category membership or unread counts, but it
  // does change how list rows collapse across every category page.
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
  revalidatePath("/snoozed");
  revalidatePath("/follow-up");
}
