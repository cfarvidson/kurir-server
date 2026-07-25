"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
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
import { SenderCategory } from "@prisma/client";

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
