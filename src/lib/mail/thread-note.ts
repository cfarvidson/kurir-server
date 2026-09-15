export const MAX_THREAD_NOTE_CHARS = 4000;

/** Grouping key a private note is stored under for this message's thread. */
export function threadNoteKey(message: {
  id: string;
  threadId?: string | null;
}): string {
  return message.threadId || message.id;
}
