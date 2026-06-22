/**
 * Optimistic snooze helper for the thread detail view.
 *
 * Mirrors `performOptimisticArchive`: navigate back to the source list
 * immediately, fire `snoozeConversation` WITHOUT awaiting it, and suppress the
 * snoozed thread's rows everywhere so they never flash in a list. A snoozed
 * thread needs exactly the same "remove from lists until refresh" behaviour as
 * an archived one, so this reuses the shared pending-suppression store and
 * cache-filtering helpers from `optimistic-archive` — the list components
 * already filter against that store, so no list changes are needed.
 *
 * Snooze read-state is orthogonal: this helper only filters caches and toggles
 * suppression — it never touches `isRead` (the server action preserves it too).
 */

import { toast } from "sonner";
import { showUndoToast } from "@/components/mail/undo-toast";
import {
  recordPendingArchive,
  clearPendingArchive,
  filterThreadFromMessageCaches,
  resolveThreadKey,
} from "@/lib/mail/optimistic-archive";
import type { QueryClient } from "@tanstack/react-query";

interface PerformOptimisticSnoozeOptions {
  messageId: string;
  until: Date;
  /** Thread collapse key. Falls back to a cache-derived lookup when absent. */
  threadKey?: string;
  returnPath: string;
  queryClient: QueryClient;
  router: { push: (path: string) => void; refresh: () => void };
  snoozeConversation: (messageId: string, until: Date) => Promise<unknown>;
  unsnoozeConversation: (messageId: string) => Promise<unknown>;
  /** Override for tests; defaults to the real toast helper. */
  showUndoToast?: typeof showUndoToast;
  /** Toast description (e.g. the subject). */
  description?: string;
  /** Override for tests; defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

const ERROR_TOAST_LABEL = "Snooze failed — the thread is back in your inbox";

/**
 * Optimistically snooze a thread from the detail view:
 *
 *  1. Record the thread key in the pending store + surgically filter the
 *     `["messages", *]` caches (so the row never flashes anywhere).
 *  2. Fire `snoozeConversation` WITHOUT awaiting (so Undo/toast chain on it).
 *  3. Show the undo toast (held open until the snooze promise settles).
 *  4. Navigate to `returnPath` immediately.
 *  5. On success refresh; on failure surface an error toast and restore the
 *     thread.
 *
 * Returns a settled-handling promise (never rejects).
 */
export function performOptimisticSnooze(
  opts: PerformOptimisticSnoozeOptions,
): Promise<unknown> {
  const {
    messageId,
    until,
    returnPath,
    queryClient,
    router,
    snoozeConversation,
    unsnoozeConversation,
    description,
    onError = console.error,
  } = opts;
  const toastFn = opts.showUndoToast ?? showUndoToast;

  const threadKey = resolveThreadKey(queryClient, messageId, opts.threadKey);

  // 1. Record + filter (so the row is gone everywhere, cold cache or not).
  recordPendingArchive(threadKey);
  filterThreadFromMessageCaches(queryClient, threadKey);

  // 2. Fire the action (declared before the toast so Undo can chain on it).
  const snoozePromise = snoozeConversation(messageId, until);

  // 3. Undo toast — held open until the snooze promise settles.
  const toastId = `snooze-${messageId}`;
  toastFn({
    id: toastId,
    label: "Snoozed",
    description,
    holdUntil: snoozePromise,
    onUndo: () => {
      // Chain on the in-flight snooze so the reverse move is ordered after it.
      // The pending key must be cleared and the cache repopulated whether the
      // unsnooze succeeds or fails — a leaked key would suppress the thread in
      // every list for the rest of the session.
      snoozePromise
        .catch(() => {
          /* snooze already failed + recovered; still attempt unsnooze */
        })
        .then(() => unsnoozeConversation(messageId))
        .then(
          () => {
            clearPendingArchive(threadKey);
            queryClient.invalidateQueries({ queryKey: ["messages"] });
            router.refresh();
          },
          (err) => {
            onError(err);
            clearPendingArchive(threadKey);
            queryClient.invalidateQueries({ queryKey: ["messages"] });
            router.refresh();
          },
        );
    },
  });

  // 4. Navigate immediately — before the action resolves.
  router.push(returnPath);

  // 5. Resolve / reject handling. No unhandled rejection.
  return snoozePromise.then(
    () => {
      clearPendingArchive(threadKey);
      router.refresh();
    },
    (err) => {
      onError(err);
      toast.error(ERROR_TOAST_LABEL, { id: toastId });
      clearPendingArchive(threadKey);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.refresh();
    },
  );
}
