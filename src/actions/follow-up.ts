"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import {
  setThreadFollowUp,
  dismissThreadFollowUp,
} from "@/lib/mail/mutations";

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

  await setThreadFollowUp(session.user.id, messageId, until);

  revalidateFollowUpPaths();
}

export async function dismissFollowUp(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await dismissThreadFollowUp(session.user.id, messageId);

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

  await setThreadFollowUp(session.user.id, messageId, until);

  revalidateFollowUpPaths();
}

export async function cancelFollowUp(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await dismissThreadFollowUp(session.user.id, messageId);

  revalidateFollowUpPaths();
}
