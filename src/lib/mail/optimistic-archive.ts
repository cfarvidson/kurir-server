/**
 * Optimistic archive helper for the thread detail view.
 *
 * The three thread-view archive entry points (archive button, mobile action
 * bar, keyboard shortcut) all need the same behaviour: navigate back to the
 * source list immediately, fire `archiveConversation` WITHOUT awaiting it, and
 * make sure the archived thread never flashes in the destination list — even
 * when the `["messages", *]` TanStack Query cache is cold (deep-link / push
 * notification entry, where there is nothing to surgically filter and the fresh
 * RSC render races the unawaited action's DB commit).
 *
 * Two mechanisms cooperate:
 *  1. Surgical cache filtering — drop every message of the thread from each
 *     cached `["messages", *]` infinite-query page (mirrors
 *     `infinite-message-list.tsx` `handleArchived`).
 *  2. A module-level pending-archive store keyed by thread key. The list
 *     components always filter rows against it, so a cold cache (nothing to
 *     surgically filter) still suppresses the thread's rows on first render.
 *
 * This module is client-safe (no `db` imports). The store lives at module
 * scope so it survives the navigation that unmounts the thread view and mounts
 * the destination list.
 */

import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { threadKeyOf } from "@/lib/mail/thread-key";
import { showUndoToast } from "@/components/mail/undo-toast";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Pending-archive store (module scope, client only)
// ---------------------------------------------------------------------------

const pendingArchiveKeys = new Set<string>();
// Thread ids pending archive. For senders with `unthread` set, list rows carry
// per-message thread keys while `archiveConversation` archives all `threadId`
// siblings — suppressing by threadId mirrors that server-side expansion so the
// sibling rows do not linger until the post-action refresh.
const pendingArchiveThreadIds = new Set<string>();
const listeners = new Set<() => void>();
// Monotonic version so `useSyncExternalStore` gets a fresh snapshot value on
// every mutation (the mutable Set keeps the same identity otherwise).
let version = 0;

function emitChange() {
  version++;
  for (const listener of listeners) listener();
}

/** Record a thread key (and its threadId, when known) as pending-archive.
 *  List rows for the key — and for any row sharing the threadId — are
 *  suppressed. */
export function recordPendingArchive(
  threadKey: string,
  threadId?: string | null,
): void {
  pendingArchiveKeys.add(threadKey);
  if (threadId) pendingArchiveThreadIds.add(threadId);
  emitChange();
}

/** Clear a pending-archive entry (after the action settles or undo resolves). */
export function clearPendingArchive(
  threadKey: string,
  threadId?: string | null,
): void {
  const removedKey = pendingArchiveKeys.delete(threadKey);
  const removedThreadId = threadId
    ? pendingArchiveThreadIds.delete(threadId)
    : false;
  if (removedKey || removedThreadId) {
    emitChange();
  }
}

/** Whether a given thread key (or the row's threadId) is pending-archive. */
export function isPendingArchive(
  threadKey: string,
  threadId?: string | null,
): boolean {
  return (
    pendingArchiveKeys.has(threadKey) ||
    (!!threadId && pendingArchiveThreadIds.has(threadId))
  );
}

/** Subscribe to pending-store changes (for `useSyncExternalStore`). */
export function subscribePendingArchive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic snapshot for `useSyncExternalStore` (changes on every mutation). */
function getVersion(): number {
  return version;
}

/** Server snapshot — pending state is always empty during SSR. */
function getServerVersion(): number {
  return 0;
}

/**
 * Subscribe a list component to the pending-archive store and get a predicate
 * for whether a thread key is currently pending-archive. Re-renders the caller
 * whenever the store changes so cold-cache deep-link lists suppress the row.
 */
export function usePendingArchiveFilter(): (
  threadKey: string,
  threadId?: string | null,
) => boolean {
  const storeVersion = useSyncExternalStore(
    subscribePendingArchive,
    getVersion,
    getServerVersion,
  );
  // A fresh closure per store version: callers put the predicate in useMemo
  // dependency arrays, so its identity must change when the store changes —
  // returning the module-level function would leave memoized lists stale.
  return useMemo(
    () => (threadKey: string, threadId?: string | null) =>
      isPendingArchive(threadKey, threadId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeVersion],
  );
}

/** Test-only reset of the module-level store. */
export function __resetPendingArchive(): void {
  pendingArchiveKeys.clear();
  pendingArchiveThreadIds.clear();
  emitChange();
}

// ---------------------------------------------------------------------------
// Cache filtering
// ---------------------------------------------------------------------------

interface CachedMessage {
  id: string;
  threadId?: string | null;
  sender?: { unthread?: boolean } | null;
}

interface CachedPage {
  messages: CachedMessage[];
  nextCursor: string | null;
}

type InfiniteCache = InfiniteData<CachedPage>;

/**
 * Remove every message belonging to `threadKey` from all cached `["messages", *]`
 * infinite-query pages. Mirrors `infinite-message-list.tsx` `handleArchived`,
 * but applied across all category caches at once (the thread view does not know
 * which category list the user came from).
 */
export function filterThreadFromMessageCaches(
  queryClient: QueryClient,
  threadKey: string,
  threadId?: string | null,
): void {
  const queries = queryClient.getQueryCache().findAll({ queryKey: ["messages"] });
  const isArchived = (m: CachedMessage) =>
    threadKeyOf(m) === threadKey || (!!threadId && m.threadId === threadId);
  for (const query of queries) {
    queryClient.setQueryData<InfiniteCache>(query.queryKey, (old) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          messages: page.messages.filter((m) => !isArchived(m)),
        })),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Navigate-then-fire archive sequence (shared by all three entry points)
// ---------------------------------------------------------------------------

interface PerformOptimisticArchiveOptions {
  messageId: string;
  /** Thread collapse key (threadId + unthread state). Falls back to a
   *  cache-derived lookup, then to `messageId`, when absent. */
  threadKey?: string;
  /** The target message's threadId. For unthreaded senders the thread key is
   *  per-message, but `archiveConversation` archives all threadId siblings —
   *  passing it lets the suppression mirror that expansion. */
  threadId?: string | null;
  returnPath: string;
  queryClient: QueryClient;
  router: { push: (path: string) => void; refresh: () => void };
  archiveConversation: (messageId: string, sourcePath?: string) => Promise<unknown>;
  unarchiveConversation: (messageId: string) => Promise<unknown>;
  /** Override for tests; defaults to the real toast helper. */
  showUndoToast?: typeof showUndoToast;
  /** Toast description (e.g. the subject). */
  description?: string;
  /** Override for tests; defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

/**
 * Derive the thread key from the cache when the caller could not compute it
 * server-side. Looks up the message across every `["messages", *]` cache and
 * uses `threadKeyOf`. Falls back to the message id (a thread of one).
 *
 * Exported so other optimistic-action helpers (e.g. snooze) can share the same
 * pending-suppression store and cache-derived thread keying.
 */
export function resolveThreadKey(
  queryClient: QueryClient,
  messageId: string,
  explicitKey?: string,
): string {
  if (explicitKey) return explicitKey;
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["messages"] });
  for (const query of queries) {
    const data = queryClient.getQueryData<InfiniteCache>(query.queryKey);
    if (!data?.pages) continue;
    for (const page of data.pages) {
      const match = page.messages.find((m) => m.id === messageId);
      if (match) return threadKeyOf(match);
    }
  }
  return messageId;
}

const ERROR_TOAST_LABEL = "Archive failed — the thread is back in your inbox";

/**
 * Optimistically archive a thread from the detail view:
 *
 *  1. Record the thread key in the pending store + surgically filter the
 *     `["messages", *]` caches (so the row never flashes anywhere).
 *  2. Fire `archiveConversation` WITHOUT awaiting (first, so Undo and the
 *     toast can chain on the stored promise).
 *  3. Show the undo toast (held open until the archive promise settles).
 *  4. Navigate to `returnPath` immediately.
 *  5. On success refresh; on failure surface an error toast and restore the
 *     thread.
 *
 * Returns a settled-handling promise (never rejects) so callers/tests can
 * chain on completion.
 */
export function performOptimisticArchive(
  opts: PerformOptimisticArchiveOptions,
): Promise<unknown> {
  const {
    messageId,
    returnPath,
    queryClient,
    router,
    archiveConversation,
    unarchiveConversation,
    description,
    onError = console.error,
  } = opts;
  const toastFn = opts.showUndoToast ?? showUndoToast;

  const threadKey = resolveThreadKey(queryClient, messageId, opts.threadKey);
  const threadId = opts.threadId ?? null;

  // 1. Record + filter (so the row is gone everywhere, cold cache or not).
  recordPendingArchive(threadKey, threadId);
  filterThreadFromMessageCaches(queryClient, threadKey, threadId);

  // 3. Fire the action (declared before the toast so Undo can chain on it).
  //    The promise is kept so Undo runs only after archive settles.
  const archivePromise = archiveConversation(messageId, returnPath);

  // 2. Undo toast — held open until the archive promise settles, then the
  //    normal countdown runs.
  const toastId = `archive-${messageId}`;
  toastFn({
    id: toastId,
    label: "Archived",
    description,
    holdUntil: archivePromise,
    onUndo: () => {
      // Chain on the in-flight archive so the reverse move is ordered after it,
      // regardless of timing. The pending key must be cleared and the cache
      // repopulated whether the unarchive succeeds or fails — a leaked key
      // would suppress the thread in every list for the rest of the session.
      archivePromise
        .catch(() => {
          /* archive already failed + recovered; still attempt unarchive */
        })
        .then(() => unarchiveConversation(messageId))
        .then(
          () => {
            clearPendingArchive(threadKey, threadId);
            // A filtered cache will not repopulate from initialData on its own.
            queryClient.invalidateQueries({ queryKey: ["messages"] });
            router.refresh();
          },
          (err) => {
            onError(err);
            clearPendingArchive(threadKey, threadId);
            queryClient.invalidateQueries({ queryKey: ["messages"] });
            router.refresh();
          },
        );
    },
  });

  // 3b. Navigate immediately — before the action resolves.
  router.push(returnPath);

  // 4. Resolve / reject handling. No unhandled rejection.
  const settled = archivePromise.then(
    () => {
      // The action committed and the row is gone from the DB and the query
      // cache; release the suppression so the store does not grow unbounded.
      // (Undo chains on `archivePromise` independently, so a not-yet-pressed
      // Undo still works — it re-adds the row via unarchive.)
      clearPendingArchive(threadKey, threadId);
      router.refresh();
    },
    (err) => {
      onError(err);
      // Surface the failure and restore the thread.
      toast.error(ERROR_TOAST_LABEL, { id: toastId });
      clearPendingArchive(threadKey, threadId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.refresh();
    },
  );

  return settled;
}

/**
 * Navigate-first unarchive (keyboard "unarchive" branch). No undo toast — the
 * unarchive path has none today and adding one is deferred. Filters the caches
 * and records pending so the row does not flash back into the archive list.
 */
export function performOptimisticUnarchive(opts: {
  messageId: string;
  threadKey?: string;
  /** See `PerformOptimisticArchiveOptions.threadId` — unarchive expands to
   *  threadId siblings server-side the same way. */
  threadId?: string | null;
  returnPath: string;
  queryClient: QueryClient;
  router: { push: (path: string) => void; refresh: () => void };
  unarchiveConversation: (messageId: string) => Promise<unknown>;
  onError?: (err: unknown) => void;
}): Promise<unknown> {
  const {
    messageId,
    returnPath,
    queryClient,
    router,
    unarchiveConversation,
    onError = console.error,
  } = opts;

  const threadKey = resolveThreadKey(queryClient, messageId, opts.threadKey);
  const threadId = opts.threadId ?? null;

  recordPendingArchive(threadKey, threadId);
  filterThreadFromMessageCaches(queryClient, threadKey, threadId);

  const promise = unarchiveConversation(messageId);
  router.push(returnPath);

  return promise.then(
    () => {
      // Mirror the archive success path — a never-cleared pending key would
      // suppress the thread in every list for the rest of the session.
      clearPendingArchive(threadKey, threadId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.refresh();
    },
    (err) => {
      onError(err);
      clearPendingArchive(threadKey, threadId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.refresh();
    },
  );
}
