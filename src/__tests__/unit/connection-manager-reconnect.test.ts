/**
 * Regression tests for deliberate-teardown auto-reconnect suppression.
 *
 * A persistent IDLE connection registers a `close` handler that schedules a
 * reconnect. When the manager tears a connection down ON PURPOSE (stopConnection
 * via admin-delete / wipe, or LRU eviction at the cap), ImapFlow's `close` event
 * fires SYNCHRONOUSLY during teardown — the old code re-triggered a reconnect
 * from inside its own cleanup. The `intentionalClose` flag suppresses that.
 *
 * These tests drive the REAL ConnectionManager singleton. The fake ImapFlow's
 * `close()` invokes registered close listeners synchronously (mirroring the real
 * client) — without that synchronous emission the tests would prove nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Fake ImapFlow ---------------------------------------------------------
// close() synchronously fires every registered `close` listener, exactly as the
// real client does during teardown. Tests can also fire `close` directly (case
// 3) to simulate a server-initiated drop.
class FakeImapFlow {
  static instances: FakeImapFlow[] = [];
  private listeners = new Map<string, Array<() => void>>();

  constructor() {
    FakeImapFlow.instances.push(this);
  }
  async connect(): Promise<void> {}
  async getMailboxLock(): Promise<{ release: () => void }> {
    return { release: () => {} };
  }
  on(event: string, cb: () => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }
  /** Synchronously invoke registered listeners for an event. */
  emit(event: string): void {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }
  close(): void {
    this.emit("close");
  }
  async logout(): Promise<void> {}
}

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn().mockResolvedValue({
    imap: { host: "imap.example.com", port: 993 },
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findUnique: vi.fn().mockResolvedValue({ userId: "user-1" }),
    },
    folder: {
      findFirst: vi.fn().mockResolvedValue({ id: "folder-inbox" }),
    },
  },
}));

vi.mock("@/lib/mail/auth-helpers", () => ({
  buildImapAuth: vi.fn().mockReturnValue({}),
}));

// sseSubscribers must expose `.has()` for the eviction candidate scan; an empty
// Map makes every connection evictable.
vi.mock("@/lib/mail/sse-subscribers", () => ({ sseSubscribers: new Map() }));

// Dynamically imported inside doStartConnection — stub so the connect path
// reaches the close-handler attach without touching the DB or network.
vi.mock("@/lib/mail/idle-handlers", () => ({
  registerIdleHandlers: vi.fn(),
  catchUpAfterReconnect: vi.fn().mockResolvedValue(undefined),
  catchUpNewMessages: vi.fn().mockResolvedValue(undefined),
}));

// Reach into the singleton's private state to isolate tests (the class is not
// exported, and stopAll() would latch `stopping=true` and break later tests).
type ManagerInternals = {
  connections: Map<string, unknown>;
  pendingReconnects: Map<string, unknown>;
  reconnectAttempts: Map<string, number>;
  starting: Set<string>;
  stopping: boolean;
};

const MAX_BACKOFF_MS = 600_000; // longest BACKOFF_SCHEDULE slot (5 min)

describe("ConnectionManager — deliberate teardown does not auto-reconnect", () => {
  let connectionManager: typeof import("@/lib/mail/connection-manager").connectionManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    FakeImapFlow.instances.length = 0;

    ({ connectionManager } = await import("@/lib/mail/connection-manager"));
    const internal = connectionManager as unknown as ManagerInternals;
    internal.connections.clear();
    internal.pendingReconnects.clear();
    internal.reconnectAttempts.clear();
    internal.starting.clear();
    internal.stopping = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stopConnection stays stopped — no reconnect after backoff", async () => {
    await connectionManager.startConnection("c-1");
    expect(FakeImapFlow.instances).toHaveLength(1);
    expect(connectionManager.isConnected("c-1")).toBe(true);

    await connectionManager.stopConnection("c-1");
    expect(connectionManager.isConnected("c-1")).toBe(false);

    // Advance past the entire backoff schedule: a suppressed close must not
    // have scheduled anything, so no new client is ever constructed.
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(FakeImapFlow.instances).toHaveLength(1);
    expect(connectionManager.isConnected("c-1")).toBe(false);
    expect(connectionManager.activeCount).toBe(0);
  });

  it("eviction at cap does not resurrect the evicted connection", async () => {
    const cap = connectionManager.maxConnections;
    for (let i = 0; i < cap; i++) {
      await connectionManager.startConnection(`c-${i}`, { evictOnCap: true });
    }
    expect(connectionManager.activeCount).toBe(cap);
    expect(FakeImapFlow.instances).toHaveLength(cap);

    // One more start at the cap evicts the least-recently-active connection
    // (c-0, first inserted). Its teardown must not trigger a reconnect.
    await connectionManager.startConnection(`c-${cap}`, { evictOnCap: true });

    expect(connectionManager.isConnected("c-0")).toBe(false);
    expect(connectionManager.activeCount).toBe(cap);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(connectionManager.isConnected("c-0")).toBe(false);
    expect(connectionManager.activeCount).toBe(cap);
  });

  it("server-initiated close still schedules a reconnect (no over-suppression)", async () => {
    await connectionManager.startConnection("c-1");
    expect(FakeImapFlow.instances).toHaveLength(1);

    // Simulate a genuine server drop: emit `close` directly, without going
    // through stopConnection/cleanup, so intentionalClose stays false.
    FakeImapFlow.instances[0].emit("close");

    // Backoff attempt 0 is a 0ms delay; advancing runs the reconnect.
    await vi.advanceTimersByTimeAsync(10);

    expect(FakeImapFlow.instances.length).toBeGreaterThan(1);
    expect(connectionManager.isConnected("c-1")).toBe(true);
  });
});
