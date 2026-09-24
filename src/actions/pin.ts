"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { setThreadPinned } from "@/lib/mail/mutations";

// A pin shows in every list the thread lives in, so every list revalidates.
function revalidatePinnedPaths() {
  updateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/sent");
  revalidatePath("/archive");
  revalidatePath("/snoozed");
  revalidatePath("/follow-up");
  revalidatePath("/reply-later");
  revalidatePath("/pinned");
}

/** Pin or unpin a thread (plan 056). */
export async function setPinned(messageId: string, isPinned: boolean) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await setThreadPinned(session.user.id, messageId, isPinned);

  revalidatePinnedPaths();
}
