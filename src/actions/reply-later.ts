"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { setThreadReplyLater } from "@/lib/mail/mutations";

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

  await setThreadReplyLater(session.user.id, messageId, true);

  revalidateReplyLaterPaths();
}

/** Remove a thread from Reply Later (replied or dismissed). */
export async function clearReplyLater(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await setThreadReplyLater(session.user.id, messageId, false);

  revalidateReplyLaterPaths();
}
