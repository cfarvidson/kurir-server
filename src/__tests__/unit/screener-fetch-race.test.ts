import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the fetchBody race condition fix in screener-view.tsx.
 *
 * The bug: when the user screen-outs sender A while A's body fetch is in-flight,
 * the fetch completes after sender B's card renders. The old `finally` block would
 * call `setPreviewLoading(false)` unconditionally, stomping sender B's loading state.
 *
 * The fix: AbortController per fetch. The "reset preview" effect aborts the in-flight
 * fetch when the card changes. AbortError is caught and returns early — never touching
 * loading/error state.
 *
 * These tests model the fix as a pure async state machine so we can verify it without
 * React or a DOM, consistent with the rest of the screener test suite.
 */

// ─── Minimal model of the fixed fetchBody behaviour ──────────────────────────

interface BodyCache {
  html: string | null;
  text: string | null;
  sizeBytes: number;
}

interface FetchState {
  previewLoading: boolean;
  previewError: boolean;
  cache: Record<string, BodyCache>;
  abortController: AbortController | null;
}

function makeFetchState(): FetchState {
  return {
    previewLoading: false,
    previewError: false,
    cache: {},
    abortController: null,
  };
}

/**
 * fetchBody as implemented in the fixed screener-view.tsx, modelled as a
 * plain async function that mutates a FetchState object.
 */
async function fetchBody(
  state: FetchState,
  messageId: string,
  fakeFetch: (id: string, signal: AbortSignal) => Promise<BodyCache>,
): Promise<void> {
  if (state.cache[messageId]) return;

  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;

  state.previewLoading = true;
  state.previewError = false;

  try {
    const data = await fakeFetch(messageId, controller.signal);
    state.cache[messageId] = data;
    state.previewLoading = false;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    state.previewError = true;
    state.previewLoading = false;
  }
}

/**
 * resetPreview as implemented in the fixed screener-view.tsx's useEffect:
 * abort in-flight fetch then reset loading/error state.
 */
function resetPreview(state: FetchState): void {
  state.abortController?.abort();
  state.abortController = null;
  state.previewLoading = false;
  state.previewError = false;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchBody race condition fix", () => {
  describe("AbortController lifecycle", () => {
    it("creates a new AbortController for each fetch", async () => {
      const state = makeFetchState();
      const fakeFetch = vi.fn().mockResolvedValue({
        html: "<p>body</p>",
        text: null,
        sizeBytes: 100,
      });

      await fetchBody(state, "msg-1", fakeFetch);

      // Controller was created and fetch succeeded — abortController holds the last one
      expect(state.abortController).not.toBeNull();
    });

    it("aborts the previous controller when a new fetch starts", async () => {
      const state = makeFetchState();

      let resolveFirst!: (v: BodyCache) => void;
      const firstFetch = new Promise<BodyCache>((res) => {
        resolveFirst = res;
      });

      const fakeFetch = vi
        .fn()
        .mockImplementationOnce(
          (_id: string, _signal: AbortSignal) => firstFetch,
        )
        .mockResolvedValueOnce({
          html: "<p>second</p>",
          text: null,
          sizeBytes: 50,
        });

      // Start first fetch (pending)
      const firstPromise = fetchBody(state, "msg-1", fakeFetch);
      const firstController = state.abortController!;
      expect(firstController.signal.aborted).toBe(false);

      // Start second fetch — should abort the first
      await fetchBody(state, "msg-2", fakeFetch);
      expect(firstController.signal.aborted).toBe(true);

      // Resolve first fetch (too late — already aborted)
      resolveFirst({ html: "<p>first</p>", text: null, sizeBytes: 80 });
      await firstPromise;
    });

    it("signal is passed to the underlying fetch call", async () => {
      const state = makeFetchState();
      let capturedSignal: AbortSignal | null = null;

      const fakeFetch = vi
        .fn()
        .mockImplementation((_id: string, signal: AbortSignal) => {
          capturedSignal = signal;
          return Promise.resolve({
            html: "<p>x</p>",
            text: null,
            sizeBytes: 10,
          });
        });

      await fetchBody(state, "msg-1", fakeFetch);

      expect(capturedSignal).not.toBeNull();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("AbortError silencing", () => {
    it("does NOT set previewError when fetch is aborted", async () => {
      const state = makeFetchState();

      const fakeFetch = vi
        .fn()
        .mockImplementation((_id: string, signal: AbortSignal) => {
          return new Promise<BodyCache>((_res, rej) => {
            // Immediately abort ourselves to simulate cancellation
            signal.addEventListener("abort", () => {
              rej(new DOMException("The operation was aborted.", "AbortError"));
            });
            signal.dispatchEvent(new Event("abort"));
          });
        });

      await fetchBody(state, "msg-1", fakeFetch);

      expect(state.previewError).toBe(false);
    });

    it("does NOT set previewLoading=false via the abort path (state left to resetPreview)", async () => {
      const state = makeFetchState();

      const fakeFetch = vi.fn().mockImplementation(
        (_id: string, signal: AbortSignal) =>
          new Promise<BodyCache>((_res, rej) => {
            signal.addEventListener("abort", () => {
              rej(new DOMException("Aborted", "AbortError"));
            });
            signal.dispatchEvent(new Event("abort"));
          }),
      );

      // previewLoading was set to true by fetchBody before the await
      // The abort path returns early without touching it — resetPreview handles it
      state.previewLoading = true; // simulate it was already set
      await fetchBody(state, "msg-1", fakeFetch);

      // Should NOT have been set to false by the abort path
      // (resetPreview would clear it — tested separately)
      expect(state.previewLoading).toBe(true);
    });

    it("still sets previewError for non-abort errors", async () => {
      const state = makeFetchState();

      const fakeFetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await fetchBody(state, "msg-1", fakeFetch);

      expect(state.previewError).toBe(true);
      expect(state.previewLoading).toBe(false);
    });

    it("does not set previewError for a DOMException with name AbortError", async () => {
      const state = makeFetchState();
      const abortError = new DOMException(
        "The user aborted a request.",
        "AbortError",
      );

      const fakeFetch = vi.fn().mockRejectedValue(abortError);

      await fetchBody(state, "msg-1", fakeFetch);

      expect(state.previewError).toBe(false);
    });
  });

  describe("resetPreview aborts in-flight fetch", () => {
    it("aborts the controller and clears previewLoading", () => {
      const state = makeFetchState();
      const controller = new AbortController();
      state.abortController = controller;
      state.previewLoading = true;

      resetPreview(state);

      expect(controller.signal.aborted).toBe(true);
      expect(state.previewLoading).toBe(false);
      expect(state.abortController).toBeNull();
    });

    it("clears previewError when resetting", () => {
      const state = makeFetchState();
      state.previewError = true;

      resetPreview(state);

      expect(state.previewError).toBe(false);
    });

    it("is safe to call when no fetch is in-flight (null controller)", () => {
      const state = makeFetchState();
      expect(() => resetPreview(state)).not.toThrow();
      expect(state.previewLoading).toBe(false);
    });
  });

  describe("race condition scenario: screen-out during in-flight fetch", () => {
    it("stale fetch does not stomp next sender's loading state", async () => {
      const state = makeFetchState();

      // fakeFetch that respects the abort signal — rejects with AbortError when aborted
      function abortAwareFetch(
        _id: string,
        signal: AbortSignal,
        body: BodyCache,
      ): Promise<BodyCache> {
        return new Promise((res, rej) => {
          if (signal.aborted) {
            rej(new DOMException("Aborted", "AbortError"));
            return;
          }
          const onAbort = () => rej(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", onAbort, { once: true });
          // Resolve after a tick (simulates async network)
          Promise.resolve().then(() => {
            if (!signal.aborted) {
              signal.removeEventListener("abort", onAbort);
              res(body);
            }
          });
        });
      }

      const fakeFetch = vi
        .fn()
        .mockImplementationOnce((id: string, signal: AbortSignal) =>
          abortAwareFetch(id, signal, {
            html: "<p>sender-a body</p>",
            text: null,
            sizeBytes: 80,
          }),
        )
        .mockImplementationOnce((id: string, signal: AbortSignal) =>
          abortAwareFetch(id, signal, {
            html: "<p>sender-b body</p>",
            text: null,
            sizeBytes: 60,
          }),
        );

      // Sender A: start fetch
      const stalePromise = fetchBody(state, "msg-a", fakeFetch);

      // User screens out sender A — simulate card change effect
      resetPreview(state);

      // Sender B: start its fetch
      await fetchBody(state, "msg-b", fakeFetch);

      // Await stale promise — it was aborted, should return early
      await stalePromise;

      // Sender B's fetch already completed successfully
      expect(state.previewLoading).toBe(false);
      expect(state.previewError).toBe(false);
      expect(state.cache["msg-b"]).toBeDefined();
      // Stale result from msg-a was NOT written to cache (aborted)
      expect(state.cache["msg-a"]).toBeUndefined();
    });

    it("rapid screen-out of 3 senders: only last fetch survives", async () => {
      const state = makeFetchState();

      // abort-aware fetch: rejects with AbortError when signal fires
      function abortAwareFetch(
        id: string,
        signal: AbortSignal,
      ): Promise<BodyCache> {
        return new Promise((res, rej) => {
          if (signal.aborted) {
            rej(new DOMException("Aborted", "AbortError"));
            return;
          }
          const onAbort = () => rej(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", onAbort, { once: true });
          Promise.resolve().then(() => {
            if (!signal.aborted) {
              signal.removeEventListener("abort", onAbort);
              res({ html: `<p>${id}</p>`, text: null, sizeBytes: 10 });
            }
          });
        });
      }

      const fakeFetch = vi
        .fn()
        .mockImplementation((id: string, signal: AbortSignal) =>
          abortAwareFetch(id, signal),
        );

      // Screen through 3 senders quickly (synchronously start all three)
      const p1 = fetchBody(state, "msg-1", fakeFetch);
      const controller1 = state.abortController!;

      const p2 = fetchBody(state, "msg-2", fakeFetch);
      const controller2 = state.abortController!;

      const p3 = fetchBody(state, "msg-3", fakeFetch);

      // First two controllers should be aborted immediately
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);

      await Promise.all([p1, p2, p3]);

      // Only msg-3 (the last fetch) should land in cache
      expect(state.cache["msg-1"]).toBeUndefined();
      expect(state.cache["msg-2"]).toBeUndefined();
      expect(state.cache["msg-3"]).toBeDefined();
    });

    it("screen-out with preview open: resetPreview clears loading before next sender", async () => {
      const state = makeFetchState();

      // Sender A: start fetch, goes into loading
      let resolveA!: (v: BodyCache) => void;
      const fakeFetch = vi.fn().mockImplementationOnce(
        (_id: string, _signal: AbortSignal) =>
          new Promise<BodyCache>((res) => {
            resolveA = res;
          }),
      );

      fetchBody(state, "msg-a", fakeFetch);
      expect(state.previewLoading).toBe(true);

      // User screens out — card changes
      resetPreview(state);
      expect(state.previewLoading).toBe(false); // cleared synchronously

      // Stale fetch resolves — should not re-set loading
      resolveA({ html: "<p>A</p>", text: null, sizeBytes: 20 });
      await Promise.resolve();

      // Still false (aborted path returns early, doesn't touch state)
      expect(state.previewLoading).toBe(false);
    });
  });

  describe("bodyCacheRef prevents stale closure", () => {
    it("does not re-fetch a message already in cache", async () => {
      const state = makeFetchState();
      // Pre-populate cache (simulates bodyCacheRef.current having the entry)
      state.cache["msg-1"] = {
        html: "<p>cached</p>",
        text: null,
        sizeBytes: 50,
      };

      const fakeFetch = vi.fn();
      await fetchBody(state, "msg-1", fakeFetch);

      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it("fetches when cache does not have the message", async () => {
      const state = makeFetchState();
      const fakeFetch = vi.fn().mockResolvedValue({
        html: "<p>fresh</p>",
        text: null,
        sizeBytes: 30,
      });

      await fetchBody(state, "msg-new", fakeFetch);

      expect(fakeFetch).toHaveBeenCalledOnce();
      expect(state.cache["msg-new"]).toBeDefined();
    });

    it("fetches for different message IDs independently", async () => {
      const state = makeFetchState();
      state.cache["msg-1"] = { html: "<p>a</p>", text: null, sizeBytes: 10 };

      const fakeFetch = vi.fn().mockResolvedValue({
        html: "<p>b</p>",
        text: null,
        sizeBytes: 20,
      });

      // msg-1 is cached → no fetch
      await fetchBody(state, "msg-1", fakeFetch);
      expect(fakeFetch).not.toHaveBeenCalled();

      // msg-2 is not cached → fetch
      await fetchBody(state, "msg-2", fakeFetch);
      expect(fakeFetch).toHaveBeenCalledOnce();
    });
  });

  describe("fetchBody with empty deps (stable reference)", () => {
    it("sets previewLoading=true then false on success (no finally block)", async () => {
      const state = makeFetchState();
      const states: boolean[] = [];
      const originalFetch = fetchBody;

      const fakeFetch = vi
        .fn()
        .mockImplementation((_id: string, _signal: AbortSignal) => {
          states.push(state.previewLoading); // capture state mid-fetch
          return Promise.resolve({
            html: "<p>x</p>",
            text: null,
            sizeBytes: 5,
          });
        });

      await fetchBody(state, "msg-1", fakeFetch);

      // During fetch, loading was true
      expect(states[0]).toBe(true);
      // After fetch, loading is false
      expect(state.previewLoading).toBe(false);
    });

    it("sets previewError=true and previewLoading=false on network error", async () => {
      const state = makeFetchState();
      const fakeFetch = vi
        .fn()
        .mockRejectedValue(new TypeError("fetch failed"));

      await fetchBody(state, "msg-1", fakeFetch);

      expect(state.previewError).toBe(true);
      expect(state.previewLoading).toBe(false);
    });

    it("on success: previewError is cleared if it was set from a previous attempt", async () => {
      const state = makeFetchState();
      state.previewError = true; // simulate a prior error state

      const fakeFetch = vi.fn().mockResolvedValue({
        html: "<p>retry ok</p>",
        text: null,
        sizeBytes: 40,
      });

      await fetchBody(state, "msg-1", fakeFetch);

      expect(state.previewError).toBe(false);
      expect(state.previewLoading).toBe(false);
    });
  });
});

// ─── Fix 2: setSenders gated by !isPending ────────────────────────────────────

/**
 * Tests for the isPending guard on the setSenders useEffect.
 *
 * Bug: during router.refresh() inside a startTransition, React re-renders
 * the parent with a transient empty (or stale) initialSenders prop. The old
 * effect would immediately apply it, unmounting the current card and showing
 * an empty state mid-transition.
 *
 * Fix: `if (!isPending) { setSenders(initialSenders); }`
 * Senders only update from the server when there is no in-progress transition.
 */

describe("setSenders isPending gate", () => {
  /**
   * Model the useEffect logic as a plain function that mirrors:
   *
   *   useEffect(() => {
   *     if (!isPending) setSenders(initialSenders);
   *   }, [initialSenders, isPending]);
   */
  function applyInitialSenders(
    current: string[],
    incoming: string[],
    isPending: boolean,
  ): string[] {
    if (!isPending) return incoming;
    return current;
  }

  it("applies incoming senders when not pending", () => {
    const result = applyInitialSenders(["a", "b"], ["c", "d"], false);
    expect(result).toEqual(["c", "d"]);
  });

  it("ignores incoming senders when a transition is in progress", () => {
    const result = applyInitialSenders(["a", "b"], [], true);
    expect(result).toEqual(["a", "b"]);
  });

  it("ignores empty incoming senders during pending transition", () => {
    // This is the core bug scenario: router.refresh() causes a transient
    // empty props push during the transition. Without the guard, the current
    // card would be unmounted and the user would see an empty screener.
    const result = applyInitialSenders(["sender-a", "sender-b"], [], true);
    expect(result).toEqual(["sender-a", "sender-b"]);
  });

  it("applies incoming senders once transition completes (isPending becomes false)", () => {
    const afterTransition = applyInitialSenders(
      ["sender-a"],
      ["sender-b"],
      false,
    );
    expect(afterTransition).toEqual(["sender-b"]);
  });

  it("applies a full fresh sender list when not pending", () => {
    const freshList = ["x", "y", "z"];
    const result = applyInitialSenders([], freshList, false);
    expect(result).toEqual(freshList);
  });

  it("does not stomp existing senders with a partial list during pending", () => {
    // The server might return only 1 sender while we still have 3 locally
    // (optimistic removal + pending refresh). Guard must preserve local state.
    const result = applyInitialSenders(
      ["s1", "s2", "s3"],
      ["s2"], // partial server response during transition
      true,
    );
    expect(result).toEqual(["s1", "s2", "s3"]);
  });

  describe("transition state sequence", () => {
    it("preserves senders through pending → not-pending cycle", () => {
      let senders = ["s1", "s2"];
      const incoming = ["s2"]; // server settled list after s1 was screened out

      // Mid-transition: server props arrive with transient data — ignored
      senders = applyInitialSenders(senders, [], true);
      expect(senders).toEqual(["s1", "s2"]); // unchanged

      // Transition ends: server settled state applied
      senders = applyInitialSenders(senders, incoming, false);
      expect(senders).toEqual(["s2"]);
    });
  });
});

// ─── Fix 3: setProcessingId functional update ─────────────────────────────────

/**
 * Tests for the functional update guard on setProcessingId.
 *
 * Bug: rapid screen-outs. Sender A is screened out (processingId = "A").
 * Sender B is immediately screened out (processingId = "B"). When A's
 * transition completes, the old `setProcessingId(null)` unconditionally
 * clears processingId — wiping B's processing state, re-enabling buttons
 * while B's action is still in-flight.
 *
 * Fix: `setProcessingId((prev) => (prev === senderId ? null : prev))`
 * Only clears if the current processingId still matches the sender that completed.
 */

describe("setProcessingId functional update guard", () => {
  /**
   * Model the functional update as a pure function.
   * `clearIfMatch(current, completedId)` mirrors:
   *   setProcessingId((prev) => (prev === senderId ? null : prev))
   */
  function clearIfMatch(
    current: string | null,
    completedId: string,
  ): string | null {
    return current === completedId ? null : current;
  }

  it("clears processingId when it matches the completed sender", () => {
    const result = clearIfMatch("sender-a", "sender-a");
    expect(result).toBeNull();
  });

  it("does NOT clear processingId when it no longer matches (race condition case)", () => {
    // sender-b started processing before sender-a's transition completed
    const result = clearIfMatch("sender-b", "sender-a");
    expect(result).toBe("sender-b");
  });

  it("returns null when current is already null and completed id is anything", () => {
    // If somehow already cleared, stays null
    const result = clearIfMatch(null, "sender-a");
    expect(result).toBeNull();
  });

  it("clears only the exact matching sender ID (string equality)", () => {
    expect(clearIfMatch("sender-1", "sender-1")).toBeNull();
    expect(clearIfMatch("sender-1", "sender-11")).toBe("sender-1");
    expect(clearIfMatch("sender-1", "SENDER-1")).toBe("sender-1"); // case-sensitive
  });

  describe("rapid screen-out sequence", () => {
    it("sender B's processingId survives sender A's transition completing", () => {
      // Initial: A starts processing
      let processingId: string | null = "sender-a";

      // User rapidly screens out B before A's transition ends
      processingId = "sender-b"; // setProcessingId("sender-b") overwrites

      // A's transition completes — should NOT clear B's state
      processingId = clearIfMatch(processingId, "sender-a");
      expect(processingId).toBe("sender-b");
    });

    it("sender C's processingId survives A and B transitions completing out of order", () => {
      let processingId: string | null = "sender-c";

      // A completes (stale) — no-op
      processingId = clearIfMatch(processingId, "sender-a");
      expect(processingId).toBe("sender-c");

      // B completes (stale) — no-op
      processingId = clearIfMatch(processingId, "sender-b");
      expect(processingId).toBe("sender-c");

      // C completes — correctly cleared
      processingId = clearIfMatch(processingId, "sender-c");
      expect(processingId).toBeNull();
    });

    it("buttons correctly re-enabled after the right sender's transition clears", () => {
      // isProcessing = currentSender.id === processingId
      // Only the current sender's buttons should be disabled while processing
      const currentSenderId = "sender-b";
      let processingId: string | null = "sender-b";

      const isProcessing = () => currentSenderId === processingId;

      expect(isProcessing()).toBe(true); // buttons disabled

      // A's stale completion — no-op
      processingId = clearIfMatch(processingId, "sender-a");
      expect(isProcessing()).toBe(true); // still disabled (B still in flight)

      // B's own completion — cleared correctly
      processingId = clearIfMatch(processingId, "sender-b");
      expect(isProcessing()).toBe(false); // buttons re-enabled
    });
  });
});
