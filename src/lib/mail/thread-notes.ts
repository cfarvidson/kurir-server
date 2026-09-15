import { db } from "@/lib/db";
import { MAX_THREAD_NOTE_CHARS } from "@/lib/mail/thread-note";

export { MAX_THREAD_NOTE_CHARS, threadNoteKey } from "@/lib/mail/thread-note";

export async function getThreadNote(
  userId: string,
  threadId: string,
): Promise<string> {
  const note = await db.threadNote.findUnique({
    where: { userId_threadId: { userId, threadId } },
    select: { body: true },
  });
  return note?.body ?? "";
}

/**
 * Upsert the private note for a thread the user owns. An empty body deletes
 * the row so a cleared note does not leave a blank record.
 */
export async function saveThreadNoteForUser(
  userId: string,
  threadId: string,
  rawBody: string,
): Promise<void> {
  const body = rawBody.trim();
  if (body.length > MAX_THREAD_NOTE_CHARS) {
    throw new Error(
      `Note is too long (max ${MAX_THREAD_NOTE_CHARS} characters).`,
    );
  }

  const owned = await db.message.findFirst({
    where: { userId, OR: [{ threadId }, { id: threadId }] },
    select: { id: true },
  });
  if (!owned) throw new Error("Thread not found");

  if (!body) {
    await db.threadNote.deleteMany({
      where: { userId, threadId },
    });
    return;
  }

  await db.threadNote.upsert({
    where: { userId_threadId: { userId, threadId } },
    create: { userId, threadId, body },
    update: { body },
  });
}
