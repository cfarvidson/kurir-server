/**
 * Selection of push-notification candidates from sync results.
 *
 * Sync callers previously re-queried the DB for Imbox messages created in the
 * last 120s, but long sync jobs (multi-folder) finish well after that window,
 * silently dropping notifications. Instead, the folder sync collects the
 * actual new Imbox messages and callers push exactly those.
 */

export interface ImboxPushMessage {
  id: string;
  fromName: string | null;
  fromAddress: string;
  subject: string | null;
  threadId: string | null;
}

interface FolderResultWithImbox {
  newImboxMessages: ImboxPushMessage[];
}

/**
 * Flatten new Imbox messages from folder sync results, deduped to one push
 * per thread. Messages are processed in ascending-UID order, so the last
 * occurrence in a thread is the newest — that one wins.
 */
export function selectImboxPushes(
  results: FolderResultWithImbox[],
): ImboxPushMessage[] {
  const byThread = new Map<string, ImboxPushMessage>();
  for (const result of results) {
    for (const m of result.newImboxMessages) {
      byThread.set(m.threadId || m.id, m);
    }
  }
  return [...byThread.values()];
}
