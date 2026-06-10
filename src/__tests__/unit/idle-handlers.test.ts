/**
 * Unit tests for the lock-aware IDLE new-message path (plan U4).
 *
 * Exercises `checkForNewMessages` — the single ingestion path the 'exists'
 * handler uses — under: free lock, held-then-released lock, exhausted lock,
 * stale lock, timer replacement, connection teardown, sync-won-the-race dedup,
 * and a P2002 unique-violation race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    syncState: { findUnique: vi.fn() },
    message: { findFirst: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/mail/sync-lock", () => ({
  isSyncLockHeld: vi.fn(),
}));

vi.mock("@/lib/mail/sse-subscribers", () => ({
  emitToUser: vi.fn(),
}));

vi.mock("@/lib/mail/push-sender", () => ({
  pushToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mail/flag-push", () => ({
  isEcho: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/mail/connection-manager", () => ({
  connectionManager: {
    getConnection: vi.fn(),
    touchActivity: vi.fn(),
  },
}));

// processMessage is dynamically imported inside the loop.
const processMessage = vi.fn();
vi.mock("@/lib/mail/sync-service", () => ({
  processMessage: (...args: unknown[]) => processMessage(...args),
}));

const CONNECTION_ID = "conn-1";
const USER_ID = "user-1";
const FOLDER_ID = "folder-inbox";

/** Build a fake live connection with a real debounceTimers Map and a fetch-able client. */
function makeConn(fetchMessages: Array<{ uid: number }> = []) {
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const listeners = new Map<string, (data: unknown) => void>();
  const client = {
    // Async-iterable fetch matching ImapFlow's shape.
    fetch: vi.fn(function* () {
      for (const m of fetchMessages) yield m;
    }),
    // Capture event listeners so tests can fire 'exists' like ImapFlow would.
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      listeners.set(event, cb);
    }),
    emit: (event: string, data?: unknown) => listeners.get(event)?.(data),
  };
  return {
    connectionId: CONNECTION_ID,
    userId: USER_ID,
    client,
    folderId: FOLDER_ID,
    debounceTimers,
  };
}

async function loadModule() {
  return import("@/lib/mail/idle-handlers");
}

describe("idle-handlers — checkForNewMessages (U4)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    const { db } = await import("@/lib/db");
    // Default: no stored messages -> lastUid 0; folder lookups resolve null.
    vi.mocked(db.message.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
    } as never);

    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    vi.mocked(isSyncLockHeld).mockResolvedValue(false);

    processMessage.mockResolvedValue({
      id: "msg-1",
      isInImbox: false,
      fromName: null,
      fromAddress: "x@y.com",
      subject: "hi",
      threadId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lock free → fetches from lastUid+1, processes, emits SSE once", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");
    const conn = makeConn([{ uid: 5 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID);

    // Range starts at lastUid(0)+1.
    expect(conn.client.fetch).toHaveBeenCalledWith(
      "1:*",
      expect.objectContaining({ source: true }),
      { uid: true },
    );
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith(USER_ID, {
      type: "new-messages",
      data: { folderId: FOLDER_ID, count: 1 },
    });
  });

  it("lock held first attempt, released before retry → ingested on retry, single SSE", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");
    const conn = makeConn([{ uid: 7 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    // First call: lock held. Subsequent (retry fire): released.
    vi.mocked(isSyncLockHeld)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID);

    // Deferred, nothing ingested yet; a retry timer is pending under "exists".
    expect(processMessage).not.toHaveBeenCalled();
    expect(conn.debounceTimers.has("exists")).toBe(true);

    // Fire the first backoff (5s) and let the async retry settle.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it("lock held across all attempts → no ingestion, one exhaustion log, no throw", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const conn = makeConn([{ uid: 9 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(isSyncLockHeld).mockResolvedValue(true); // always held

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID); // attempt 0 -> schedule 5s

    // Three retries: 5s, 15s, 30s; the 4th invocation exhausts and gives up.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(processMessage).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    // No more pending timer once exhausted.
    expect(conn.debounceTimers.has("exists")).toBe(false);

    const gaveUp = logSpy.mock.calls.some((c) =>
      String(c[0]).includes("giving up"),
    );
    expect(gaveUp).toBe(true);
  });

  it("stale lock → isSyncLockHeld returns false → proceeds immediately", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    const conn = makeConn([{ uid: 3 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    // Stale-aware predicate already collapses a stale lock to "not held".
    vi.mocked(isSyncLockHeld).mockResolvedValue(false);

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID);

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(conn.debounceTimers.has("exists")).toBe(false);
  });

  it("retry pending + new exists event → timer replaced, exactly one execution", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    const conn = makeConn([{ uid: 11 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    // Held the first time (schedules a retry), free afterwards.
    vi.mocked(isSyncLockHeld)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const mod = await loadModule();
    mod.registerIdleHandlers(conn as never);

    // First 'exists' → debounce → check finds lock held → schedules a 5s retry.
    conn.client.emit("exists", {});
    await vi.advanceTimersByTimeAsync(200); // run the 200ms debounce
    const pendingAfterFirst = conn.debounceTimers.get("exists");
    expect(pendingAfterFirst).toBeDefined(); // retry timer is pending

    // A fresh 'exists' arrives: its 200ms debounce must REPLACE the pending
    // retry under the same key (not stack), and reset the attempt budget.
    conn.client.emit("exists", {});
    expect(conn.debounceTimers.get("exists")).not.toBe(pendingAfterFirst);
    expect(conn.debounceTimers.size).toBe(1); // exactly one pending timer

    // Drain everything; exactly one ingestion runs.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  it("connection torn down while retry pending → no fetch on a destroyed client", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
    const conn = makeConn([{ uid: 13 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(isSyncLockHeld).mockResolvedValueOnce(true);

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID); // schedules retry at 5s

    // Teardown: connection-manager no longer knows this connection, and
    // teardown would have cleared the timer map. Simulate both.
    conn.debounceTimers.clear();
    vi.mocked(connectionManager.getConnection).mockReturnValue(undefined);

    await vi.advanceTimersByTimeAsync(5_000);

    // The timer was cleared by teardown; even if it fired, re-resolution aborts.
    expect(conn.client.fetch).not.toHaveBeenCalled();
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("sync ingested the UID first → existence check hits → count 0, no SSE, no push", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");
    const { pushToUser } = await import("@/lib/mail/push-sender");
    const { db } = await import("@/lib/db");
    const conn = makeConn([{ uid: 21 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    // lastUid lookup -> null (0), then per-UID existence check -> row exists.
    vi.mocked(db.message.findFirst)
      .mockResolvedValueOnce(null as never) // highest-uid lookup
      .mockResolvedValueOnce({ id: "already" } as never); // per-uid exists

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID);

    expect(processMessage).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
    expect(pushToUser).not.toHaveBeenCalled();
  });

  it("P2002 race on one message → row not duplicated, loop continues, no crash", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");
    const conn = makeConn([{ uid: 31 }, { uid: 32 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    // First message: concurrent sync inserted it -> P2002. Second: succeeds.
    processMessage
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
      .mockResolvedValueOnce({
        id: "msg-32",
        isInImbox: false,
        fromName: null,
        fromAddress: "x@y.com",
        subject: "ok",
        threadId: null,
      });

    const { checkForNewMessages } = await loadModule();
    await expect(checkForNewMessages(CONNECTION_ID)).resolves.toBeUndefined();

    // Both attempted; loop did not abort on the P2002.
    expect(processMessage).toHaveBeenCalledTimes(2);
    // Only the second counted as new -> single SSE with count 1.
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith(USER_ID, {
      type: "new-messages",
      data: { folderId: FOLDER_ID, count: 1 },
    });
  });

  it("emits push for new Imbox messages, deduped by thread", async () => {
    const { connectionManager } = await import("@/lib/mail/connection-manager");
    const { pushToUser } = await import("@/lib/mail/push-sender");
    const conn = makeConn([{ uid: 41 }, { uid: 42 }]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);

    processMessage
      .mockResolvedValueOnce({
        id: "a",
        isInImbox: true,
        fromName: "A",
        fromAddress: "a@y.com",
        subject: "one",
        threadId: "t1",
      })
      .mockResolvedValueOnce({
        id: "b",
        isInImbox: true,
        fromName: "B",
        fromAddress: "b@y.com",
        subject: "two",
        threadId: "t1", // same thread -> deduped
      });

    const { checkForNewMessages } = await loadModule();
    await checkForNewMessages(CONNECTION_ID);

    expect(pushToUser).toHaveBeenCalledTimes(1);
  });
});
