/**
 * Stable grouping key for thread collapsing. Messages whose sender is flagged
 * `unthread` use their own id as the key so they render as standalone rows;
 * everyone else groups by `threadId` (or own id when threadId is null).
 *
 * Lives in its own client-safe module (no `db` imports) so it can be shared
 * between the server-side `collapseToThreads` in `@/lib/mail/threads` and the
 * client-side pagination collapse in `InfiniteMessageList`.
 */
export function threadKeyOf(msg: {
  id: string;
  threadId: string | null | undefined;
  sender?: { unthread?: boolean } | null;
}): string {
  if (msg.sender?.unthread) return msg.id;
  return msg.threadId || msg.id;
}
