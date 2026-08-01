/**
 * NOOP keepalive on the IDLE connection.
 *
 * iCloud silently stops pushing EXISTS updates on a long-lived IDLE session,
 * leaving new mail to the 60s sync-job backstop (23–114s observed ingest lag).
 * The manager runs a periodic NOOP on the IDLE client to force the server to
 * flush pending untagged responses; teardown must clear the interval or the
 * timer keeps a dead client (and the conn object) alive.
 *
 * Same harness as connection-manager-reconnect.test.ts: fake ImapFlow driving
 * the real ConnectionManager singleton, fake timers to advance the interval.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class FakeImapFlow {
  static instances: FakeImapFlow[] = [];
  noop = vi.fn().mockResolvedValue(undefined);
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

vi.mock("@/lib/mail/sse-subscribers", () => ({ sseSubscribers: new Map() }));

vi.mock("@/lib/mail/idle-handlers", () => ({
  registerIdleHandlers: vi.fn(),
  catchUpAfterReconnect: vi.fn().mockResolvedValue(undefined),
  catchUpNewMessages: vi.fn().mockResolvedValue(undefined),
}));

type ManagerInternals = {
  connections: Map<string, unknown>;
  pendingReconnects: Map<string, unknown>;
  reconnectAttempts: Map<string, number>;
  starting: Set<string>;
  stopping: boolean;
};

const NOOP_INTERVAL_MS = 15_000;

describe("ConnectionManager — IDLE NOOP keepalive", () => {
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

  it("sends NOOP on the interval while connected", async () => {
    await connectionManager.startConnection("c-1");
    const client = FakeImapFlow.instances[0];
    expect(client.noop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NOOP_INTERVAL_MS * 3);
    expect(client.noop).toHaveBeenCalledTimes(3);
  });

  it("stops the NOOP interval on teardown", async () => {
    await connectionManager.startConnection("c-1");
    const client = FakeImapFlow.instances[0];

    await connectionManager.stopConnection("c-1");
    await vi.advanceTimersByTimeAsync(NOOP_INTERVAL_MS * 4);
    expect(client.noop).not.toHaveBeenCalled();
  });

  it("a NOOP failure does not crash and the reconnect path owns recovery", async () => {
    await connectionManager.startConnection("c-1");
    const client = FakeImapFlow.instances[0];
    client.noop.mockRejectedValue(new Error("socket closed"));

    // Must not throw (unhandled rejection would fail the test run).
    await vi.advanceTimersByTimeAsync(NOOP_INTERVAL_MS * 2);
    expect(client.noop).toHaveBeenCalledTimes(2);
    expect(connectionManager.isConnected("c-1")).toBe(true);
  });
});
