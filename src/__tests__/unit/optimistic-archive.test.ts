import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Mock sonner so the helper's error-path `toast.error(...)` is observable and
// does not require a DOM. The undo-toast module imports sonner too.
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, custom: vi.fn(), dismiss: vi.fn() },
}));

import {
  performOptimisticArchive,
  performOptimisticUnarchive,
  filterThreadFromMessageCaches,
  recordPendingArchive,
  clearPendingArchive,
  isPendingArchive,
  __resetPendingArchive,
} from "@/lib/mail/optimistic-archive";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeMessage {
  id: string;
  threadId?: string | null;
  sender?: { unthread?: boolean } | null;
}

function msg(
  id: string,
  threadId?: string | null,
  unthread = false,
): FakeMessage {
  return { id, threadId: threadId ?? null, sender: { unthread } };
}

function seedCache(
  client: QueryClient,
  category: string,
  pages: FakeMessage[][],
) {
  client.setQueryData(["messages", category], {
    pages: pages.map((messages, i) => ({
      messages,
      nextCursor: i < pages.length - 1 ? `cursor-${i}` : null,
    })),
    pageParams: pages.map(() => null),
  });
}

function cacheMessageIds(client: QueryClient, category: string): string[] {
  const data = client.getQueryData<{
    pages: { messages: FakeMessage[] }[];
  }>(["messages", category]);
  return (data?.pages ?? []).flatMap((p) => p.messages.map((m) => m.id));
}

/** A deferred promise so we can control action timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRouter() {
  return { push: vi.fn(), refresh: vi.fn() };
}

interface ToastOpts {
  id: string;
  label: string;
  description?: string;
  holdUntil?: Promise<unknown>;
  onUndo: () => void;
}

const noopToast = vi.fn((_opts: ToastOpts) => "toast-id");

beforeEach(() => {
  __resetPendingArchive();
  toastError.mockClear();
  noopToast.mockClear();
});

// ---------------------------------------------------------------------------
// Store API + list filter (cold cache / deep link)
// ---------------------------------------------------------------------------

describe("pending-archive store", () => {
  it("records, checks, and clears thread keys", () => {
    expect(isPendingArchive("t1")).toBe(false);
    recordPendingArchive("t1");
    expect(isPendingArchive("t1")).toBe(true);
    clearPendingArchive("t1");
    expect(isPendingArchive("t1")).toBe(false);
  });

  it("suppresses a thread even with no message cache (deep link)", () => {
    // No ["messages"] cache exists at all — store alone must suppress.
    recordPendingArchive("thread-deep");
    expect(isPendingArchive("thread-deep")).toBe(true);
  });
});

describe("filterThreadFromMessageCaches", () => {
  it("removes every message of the thread from all category caches", () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [
      [msg("a", "t1"), msg("b", "t1"), msg("c", "t2")],
    ]);
    seedCache(client, "feed", [[msg("d", "t1"), msg("e", "t3")]]);

    filterThreadFromMessageCaches(client, "t1");

    expect(cacheMessageIds(client, "imbox").sort()).toEqual(["c"]);
    expect(cacheMessageIds(client, "feed").sort()).toEqual(["e"]);
  });

  it("is a no-op when there is no cache", () => {
    const client = new QueryClient();
    expect(() => filterThreadFromMessageCaches(client, "t1")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// performOptimisticArchive — happy path
// ---------------------------------------------------------------------------

describe("performOptimisticArchive", () => {
  it("happy path: records pending, filters caches, navigates before action resolves, refreshes + clears after", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1"), msg("b", "t1"), msg("c", "t2")]]);
    const router = makeRouter();
    const d = deferred<void>();
    const archive = vi.fn(() => d.promise);
    const unarchive = vi.fn(() => Promise.resolve());

    const settled = performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: unarchive,
      showUndoToast: noopToast,
    });

    // Pending recorded + caches filtered immediately.
    expect(isPendingArchive("t1")).toBe(true);
    expect(cacheMessageIds(client, "imbox").sort()).toEqual(["c"]);

    // Navigation happened before the action resolved.
    expect(router.push).toHaveBeenCalledWith("/imbox");
    expect(archive).toHaveBeenCalledWith("a", "/imbox");
    expect(router.refresh).not.toHaveBeenCalled();

    // Toast was shown and held on the archive promise.
    expect(noopToast).toHaveBeenCalledTimes(1);
    expect(noopToast.mock.calls[0][0].holdUntil).toBe(d.promise);

    d.resolve();
    await settled;

    expect(router.refresh).toHaveBeenCalledTimes(1);
    // Pending entry cleared once the action commits + refresh fires (the row is
    // gone from the cache and DB; the store must not grow unbounded).
    expect(isPendingArchive("t1")).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("falls back to cache-derived thread key when threadKey prop is absent", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t9"), msg("b", "t9")]]);
    const router = makeRouter();
    const archive = vi.fn(() => Promise.resolve());

    const settled = performOptimisticArchive({
      messageId: "a",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    expect(isPendingArchive("t9")).toBe(true);
    expect(cacheMessageIds(client, "imbox")).toEqual([]);
    await settled;
  });

  it("idempotent re-archive of an already-archived message: no error toast, no crash", async () => {
    const client = new QueryClient();
    const router = makeRouter();
    const archive = vi.fn(() => Promise.resolve());

    const settled = performOptimisticArchive({
      messageId: "gone",
      threadKey: "gone",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    await expect(settled).resolves.toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------

  it("undo in flight: unarchive only runs after the archive promise settles", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const router = makeRouter();
    const archiveD = deferred<void>();
    const order: string[] = [];
    const archive = vi.fn(() => {
      return archiveD.promise.then(() => {
        order.push("archive");
      });
    });
    const unarchive = vi.fn(() => {
      order.push("unarchive");
      return Promise.resolve();
    });

    performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: unarchive,
      showUndoToast: noopToast,
    });

    // Press Undo while the archive promise is still pending.
    const onUndo = noopToast.mock.calls[0][0].onUndo;
    onUndo();

    // Unarchive must NOT have run yet — archive hasn't settled.
    expect(unarchive).not.toHaveBeenCalled();

    archiveD.resolve();
    // Flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(["archive", "unarchive"]);
  });

  it("undo restores visibility: clears pending, invalidates ['messages'], refreshes", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const archive = vi.fn(() => Promise.resolve());
    const unarchive = vi.fn(() => Promise.resolve());

    performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: unarchive,
      showUndoToast: noopToast,
    });

    const onUndo = noopToast.mock.calls[0][0].onUndo;
    onUndo();
    await new Promise((r) => setTimeout(r, 0));

    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("undo failure: pending cleared and cache repopulated even when unarchive rejects", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const onError = vi.fn();
    const archive = vi.fn(() => Promise.resolve());
    const unarchive = vi.fn(() => Promise.reject(new Error("boom")));

    performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: unarchive,
      showUndoToast: noopToast,
      onError,
    });

    const onUndo = noopToast.mock.calls[0][0].onUndo;
    onUndo();
    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalled();
    // A rejected unarchive must not leak the pending key (session-long
    // suppression) — the thread stays archived but visible state recovers.
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Rapid serial archives
  // -------------------------------------------------------------------------

  it("rapid serial archives: three distinct ids, cumulative filtering, distinct toast ids", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [
      [msg("a", "t1"), msg("b", "t2"), msg("c", "t3"), msg("d", "t4")],
    ]);
    const router = makeRouter();
    const archive = vi.fn(() => Promise.resolve());
    const unarchive = vi.fn(() => Promise.resolve());

    for (const [id, key] of [
      ["a", "t1"],
      ["b", "t2"],
      ["c", "t3"],
    ] as const) {
      performOptimisticArchive({
        messageId: id,
        threadKey: key,
        returnPath: "/imbox",
        queryClient: client,
        router,
        archiveConversation: archive,
        unarchiveConversation: unarchive,
        showUndoToast: noopToast,
      });
    }

    expect(isPendingArchive("t1")).toBe(true);
    expect(isPendingArchive("t2")).toBe(true);
    expect(isPendingArchive("t3")).toBe(true);
    // Only t4 (msg d) remains.
    expect(cacheMessageIds(client, "imbox")).toEqual(["d"]);

    const toastIds = noopToast.mock.calls.map((c) => c[0].id);
    expect(new Set(toastIds).size).toBe(3);
    expect(toastIds).toEqual(["archive-a", "archive-b", "archive-c"]);
  });

  // -------------------------------------------------------------------------
  // Toast lifetime
  // -------------------------------------------------------------------------

  it("toast lifetime: holdUntil is the archive promise (actionable while pending)", async () => {
    const client = new QueryClient();
    const router = makeRouter();
    const d = deferred<void>();
    const archive = vi.fn(() => d.promise);

    const settled = performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    const opts = noopToast.mock.calls[0][0];
    expect(opts.holdUntil).toBeInstanceOf(Promise);
    // Undo is still available (onUndo provided) while pending.
    expect(typeof opts.onUndo).toBe("function");

    d.resolve();
    await settled;
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  it("error path: error toast, pending cleared, invalidated, refresh, no unhandled rejection", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const archive = vi.fn(() => Promise.reject(new Error("boom")));
    const onError = vi.fn();

    const settled = performOptimisticArchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
      onError,
    });

    // Must resolve (not reject) — no unhandled rejection.
    await expect(settled).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Archive failed — the thread is back in your inbox",
      { id: "archive-a" },
    );
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Integration: populated infinite cache
  // -------------------------------------------------------------------------

  it("integration: removes exactly the thread's messages from a multi-page infinite cache", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [
      [msg("p1a", "t1"), msg("p1b", "t2")],
      [msg("p2a", "t1"), msg("p2b", "t3")],
    ]);
    const router = makeRouter();
    const archive = vi.fn(() => Promise.resolve());

    const settled = performOptimisticArchive({
      messageId: "p1a",
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      archiveConversation: archive,
      unarchiveConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    const data = client.getQueryData<{
      pages: { messages: FakeMessage[]; nextCursor: string | null }[];
    }>(["messages", "imbox"]);
    // Page structure preserved; only t1 messages removed.
    expect(data?.pages).toHaveLength(2);
    expect(data?.pages[0].messages.map((m) => m.id)).toEqual(["p1b"]);
    expect(data?.pages[1].messages.map((m) => m.id)).toEqual(["p2b"]);
    expect(data?.pages[0].nextCursor).toBe("cursor-0");
    await settled;
  });
});

// ---------------------------------------------------------------------------
// performOptimisticUnarchive (keyboard unarchive branch)
// ---------------------------------------------------------------------------

describe("performOptimisticUnarchive", () => {
  it("navigates first, filters cache, refreshes after — no undo toast", async () => {
    const client = new QueryClient();
    seedCache(client, "archive", [[msg("a", "t1"), msg("b", "t2")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const d = deferred<void>();
    const unarchive = vi.fn(() => d.promise);

    const settled = performOptimisticUnarchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/archive",
      queryClient: client,
      router,
      unarchiveConversation: unarchive,
    });

    expect(isPendingArchive("t1")).toBe(true);
    expect(cacheMessageIds(client, "archive")).toEqual(["b"]);
    expect(router.push).toHaveBeenCalledWith("/archive");
    expect(router.refresh).not.toHaveBeenCalled();

    d.resolve();
    await settled;
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // The pending key MUST be released on success — a leaked key would
    // suppress this thread in every list for the rest of the session.
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
  });

  it("error path: clears pending, invalidates, refreshes, no unhandled rejection", async () => {
    const client = new QueryClient();
    seedCache(client, "archive", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const onError = vi.fn();
    const unarchive = vi.fn(() => Promise.reject(new Error("boom")));

    const settled = performOptimisticUnarchive({
      messageId: "a",
      threadKey: "t1",
      returnPath: "/archive",
      queryClient: client,
      router,
      unarchiveConversation: unarchive,
      onError,
    });

    await expect(settled).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });
});
