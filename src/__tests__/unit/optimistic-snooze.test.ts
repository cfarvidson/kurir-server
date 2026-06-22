import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Mock sonner so the helper's error-path `toast.error(...)` is observable and
// does not require a DOM. The undo-toast module imports sonner too.
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, custom: vi.fn(), dismiss: vi.fn() },
}));

import { performOptimisticSnooze } from "@/lib/mail/optimistic-snooze";
import {
  isPendingArchive,
  __resetPendingArchive,
} from "@/lib/mail/optimistic-archive";

interface FakeMessage {
  id: string;
  threadId?: string | null;
  sender?: { unthread?: boolean } | null;
}

function msg(id: string, threadId?: string | null): FakeMessage {
  return { id, threadId: threadId ?? null, sender: { unthread: false } };
}

function seedCache(client: QueryClient, category: string, pages: FakeMessage[][]) {
  client.setQueryData(["messages", category], {
    pages: pages.map((messages, i) => ({
      messages,
      nextCursor: i < pages.length - 1 ? `cursor-${i}` : null,
    })),
    pageParams: pages.map(() => null),
  });
}

function cacheMessageIds(client: QueryClient, category: string): string[] {
  const data = client.getQueryData<{ pages: { messages: FakeMessage[] }[] }>([
    "messages",
    category,
  ]);
  return (data?.pages ?? []).flatMap((p) => p.messages.map((m) => m.id));
}

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
const future = new Date(Date.now() + 60 * 60_000);

beforeEach(() => {
  __resetPendingArchive();
  toastError.mockClear();
  noopToast.mockClear();
});

describe("performOptimisticSnooze", () => {
  it("happy path: filters caches, navigates before action resolves, refreshes + clears after", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1"), msg("b", "t1"), msg("c", "t2")]]);
    const router = makeRouter();
    const d = deferred<void>();
    const snooze = vi.fn(() => d.promise);
    const unsnooze = vi.fn(() => Promise.resolve());

    const settled = performOptimisticSnooze({
      messageId: "a",
      until: future,
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: snooze,
      unsnoozeConversation: unsnooze,
      showUndoToast: noopToast,
    });

    // Suppressed + caches filtered immediately; navigation before resolve.
    expect(isPendingArchive("t1")).toBe(true);
    expect(cacheMessageIds(client, "imbox").sort()).toEqual(["c"]);
    expect(router.push).toHaveBeenCalledWith("/imbox");
    expect(snooze).toHaveBeenCalledWith("a", future);
    expect(router.refresh).not.toHaveBeenCalled();

    // Toast held on the snooze promise.
    expect(noopToast).toHaveBeenCalledTimes(1);
    expect(noopToast.mock.calls[0][0].holdUntil).toBe(d.promise);
    expect(noopToast.mock.calls[0][0].id).toBe("snooze-a");

    d.resolve();
    await settled;

    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(isPendingArchive("t1")).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("falls back to cache-derived thread key when threadKey prop is absent", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t9"), msg("b", "t9")]]);
    const router = makeRouter();

    const settled = performOptimisticSnooze({
      messageId: "a",
      until: future,
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: vi.fn(() => Promise.resolve()),
      unsnoozeConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    expect(isPendingArchive("t9")).toBe(true);
    expect(cacheMessageIds(client, "imbox")).toEqual([]);
    await settled;
  });

  it("undo in flight: unsnooze only runs after the snooze promise settles", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const router = makeRouter();
    const snoozeD = deferred<void>();
    const order: string[] = [];
    const snooze = vi.fn(() => snoozeD.promise.then(() => order.push("snooze")));
    const unsnooze = vi.fn(() => {
      order.push("unsnooze");
      return Promise.resolve();
    });

    performOptimisticSnooze({
      messageId: "a",
      until: future,
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: snooze,
      unsnoozeConversation: unsnooze,
      showUndoToast: noopToast,
    });

    noopToast.mock.calls[0][0].onUndo();
    expect(unsnooze).not.toHaveBeenCalled();

    snoozeD.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(["snooze", "unsnooze"]);
  });

  it("undo restores visibility: clears pending, invalidates ['messages'], refreshes", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();

    performOptimisticSnooze({
      messageId: "a",
      until: future,
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: vi.fn(() => Promise.resolve()),
      unsnoozeConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
    });

    noopToast.mock.calls[0][0].onUndo();
    await new Promise((r) => setTimeout(r, 0));

    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("undo failure: pending cleared and cache repopulated even when unsnooze rejects", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const onError = vi.fn();

    performOptimisticSnooze({
      messageId: "a",
      until: future,
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: vi.fn(() => Promise.resolve()),
      unsnoozeConversation: vi.fn(() => Promise.reject(new Error("boom"))),
      showUndoToast: noopToast,
      onError,
    });

    noopToast.mock.calls[0][0].onUndo();
    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalled();
    // A rejected unsnooze must not leak the pending key (session-long
    // suppression); visible state still recovers.
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("error path: error toast, pending cleared, invalidated, refresh, no unhandled rejection", async () => {
    const client = new QueryClient();
    seedCache(client, "imbox", [[msg("a", "t1")]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const router = makeRouter();
    const onError = vi.fn();
    const snooze = vi.fn(() => Promise.reject(new Error("boom")));

    const settled = performOptimisticSnooze({
      messageId: "a",
      until: future,
      threadKey: "t1",
      returnPath: "/imbox",
      queryClient: client,
      router,
      snoozeConversation: snooze,
      unsnoozeConversation: vi.fn(() => Promise.resolve()),
      showUndoToast: noopToast,
      onError,
    });

    await expect(settled).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Snooze failed — the thread is back in your inbox",
      { id: "snooze-a" },
    );
    expect(isPendingArchive("t1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["messages"] });
    expect(router.refresh).toHaveBeenCalled();
  });
});
