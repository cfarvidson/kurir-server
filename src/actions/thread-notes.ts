"use server";

import { auth } from "@/lib/auth";
import { saveThreadNoteForUser } from "@/lib/mail/thread-notes";

/** Save or clear the private note on a thread. Never included in outgoing mail. */
export async function saveThreadNote(threadId: string, body: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await saveThreadNoteForUser(session.user.id, threadId, body);
}
