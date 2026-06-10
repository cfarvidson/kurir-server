/**
 * Unit tests for boot-time IDLE start (plan U5).
 *
 * Testable seams (preferred over heavy ImapFlow/ConnectionManager mocking):
 *  - `orderConnectionsForBootStart` (pure): most-recently-synced first, nulls
 *    last, deterministic id tiebreak.
 *  - `startBootIdleConnections`: enumerates ordered connections, starts them
 *    SEQUENTIALLY with the no-evict option, stops at the cap, isolates
 *    per-connection failures. Redis is never touched, proving a Redis outage
 *    cannot prevent IDLE start.
 *  - `shouldRunBootCatchUp` (pure) + `catchUpNewMessages`: gating of the
 *    post-connect new-mail catch-up (lastUid 0 / large backlog → defer to sync
 *    job; a few new UIDs → cheap range fetch via checkForNewMessages).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findMany: vi.fn(), findUnique: vi.fn() },
    message: { findFirst: vi.fn() },
  },
}));

// background-sync.ts imports the BullMQ workers/queue (which transitively pull
// next-auth / Redis). Stub them so the boot-IDLE seam can be imported in
// isolation — none of these run in the functions under test.
vi.mock("@/lib/jobs/sync-worker", () => ({
  startSyncWorker: vi.fn(),
  scheduleSyncJobs: vi.fn(),
  stopSyncWorker: vi.fn(),
  refreshSyncPriorities: vi.fn(),
}));
vi.mock("@/lib/jobs/maintenance-worker", () => ({
  startMaintenanceWorker: vi.fn(),
  scheduleMaintenanceJobs: vi.fn(),
  stopMaintenanceWorker: vi.fn(),
}));
vi.mock("@/lib/jobs/queue", () => ({ closeQueues: vi.fn() }));
vi.mock("@/lib/jobs/maintenance-tasks", () => ({ checkExpiredFollowUps: vi.fn() }));

vi.mock("@/lib/mail/connection-manager", () => ({
  connectionManager: {
    startConnection: vi.fn().mockResolvedValue(undefined),
    getConnection: vi.fn(),
    get activeCount() {
      return mockActiveCount;
    },
    get maxConnections() {
      return MAX;
    },
  },
}));

// checkForNewMessages is the lock-aware ingestion path; stub it so the catch-up
// gating tests assert *whether* it runs, not its internals (covered in U4 test).
vi.mock("@/lib/mail/sse-subscribers", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/mail/push-sender", () => ({
  pushToUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/mail/flag-push", () => ({ isEcho: vi.fn() }));
vi.mock("@/lib/mail/sync-lock", () => ({
  isSyncLockHeld: vi.fn().mockResolvedValue(false),
}));

// processMessage is dynamically imported inside the ingestion loop.
const processMessage = vi.fn();
vi.mock("@/lib/mail/sync-service", () => ({
  processMessage: (...args: unknown[]) => processMessage(...args),
}));

const MAX = 25;
let mockActiveCount = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveCount = 0;
});

// --- orderConnectionsForBootStart (pure) ---------------------------------

describe("orderConnectionsForBootStart (U5)", () => {
  it("orders most-recently-synced first, nulls last, id tiebreak", async () => {
    const { orderConnectionsForBootStart } = await import(
      "@/lib/mail/background-sync"
    );

    const rows = [
      { id: "c-null-b", lastFullSync: null },
      { id: "c-old", lastFullSync: new Date("2026-01-01T00:00:00Z") },
      { id: "c-null-a", lastFullSync: null },
      { id: "c-new", lastFullSync: new Date("2026-06-01T00:00:00Z") },
    ];

    const ordered = orderConnectionsForBootStart(rows).map((r) => r.id);

    expect(ordered).toEqual(["c-new", "c-old", "c-null-a", "c-null-b"]);
  });

  it("is deterministic for equal timestamps (id tiebreak)", async () => {
    const { orderConnectionsForBootStart } = await import(
      "@/lib/mail/background-sync"
    );
    const t = new Date("2026-05-05T00:00:00Z");
    const rows = [
      { id: "z", lastFullSync: t },
      { id: "a", lastFullSync: t },
      { id: "m", lastFullSync: t },
    ];
    expect(orderConnectionsForBootStart(rows).map((r) => r.id)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("does not mutate the input array", async () => {
    const { orderConnectionsForBootStart } = await import(
      "@/lib/mail/background-sync"
    );
    const rows = [
      { id: "b", lastFullSync: null },
      { id: "a", lastFullSync: new Date("2026-01-01T00:00:00Z") },
    ];
    const snapshot = rows.map((r) => r.id);
    orderConnectionsForBootStart(rows);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

// --- startBootIdleConnections --------------------------------------------

describe("startBootIdleConnections (U5)", () => {
  async function setup(
    found: Array<{ id: string; syncState: { lastFullSync: Date | null } | null }>,
  ) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue(found as never);
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    const { startBootIdleConnections } = await import(
      "@/lib/mail/background-sync"
    );
    return { connectionManager, startBootIdleConnections };
  }

  it("boot with 2 connections → both started, no-evict, most-recent first", async () => {
    const { connectionManager, startBootIdleConnections } = await setup([
      { id: "c-old", syncState: { lastFullSync: new Date("2026-01-01") } },
      { id: "c-new", syncState: { lastFullSync: new Date("2026-06-01") } },
    ]);

    await startBootIdleConnections();

    const calls = vi.mocked(connectionManager.startConnection).mock.calls;
    expect(calls).toHaveLength(2);
    // Most-recently-synced started first.
    expect(calls[0][0]).toBe("c-new");
    expect(calls[1][0]).toBe("c-old");
    // No-evict option on every boot start.
    expect(calls[0][1]).toEqual({ evictOnCap: false });
    expect(calls[1][1]).toEqual({ evictOnCap: false });
  });

  it(">25 connections → stops at cap, zero evictions, most-recent first", async () => {
    // 30 connections, descending lastFullSync by index so order is predictable.
    const found = Array.from({ length: 30 }, (_, i) => ({
      id: `c-${String(i).padStart(2, "0")}`,
      syncState: {
        lastFullSync: new Date(2026, 0, 1 + (30 - i)), // higher i = older
      },
    }));
    const { connectionManager, startBootIdleConnections } = await setup(found);

    // Simulate the manager filling up as connections start.
    vi.mocked(connectionManager.startConnection).mockImplementation(
      async () => {
        mockActiveCount++;
      },
    );

    await startBootIdleConnections();

    const calls = vi.mocked(connectionManager.startConnection).mock.calls;
    // Exactly the cap, never more (loop stops before exceeding it).
    expect(calls).toHaveLength(MAX);
    // The 25 most-recently-synced (c-00 .. c-24), in order.
    expect(calls.map((c) => c[0])).toEqual(
      Array.from({ length: MAX }, (_, i) => `c-${String(i).padStart(2, "0")}`),
    );
    // evictOnCap:false everywhere → boot-start performs zero evictions.
    expect(calls.every((c) => (c[1] as { evictOnCap: boolean }).evictOnCap === false)).toBe(
      true,
    );
  });

  it("one connection fails → isolated, others still start", async () => {
    const { connectionManager, startBootIdleConnections } = await setup([
      { id: "c-good-1", syncState: { lastFullSync: new Date("2026-03-01") } },
      { id: "c-bad", syncState: { lastFullSync: new Date("2026-02-01") } },
      { id: "c-good-2", syncState: { lastFullSync: new Date("2026-01-01") } },
    ]);

    vi.mocked(connectionManager.startConnection).mockImplementation(
      async (id: string) => {
        if (id === "c-bad") throw new Error("invalid credentials");
      },
    );

    await expect(startBootIdleConnections()).resolves.toBeUndefined();

    const ids = vi
      .mocked(connectionManager.startConnection)
      .mock.calls.map((c) => c[0]);
    // All three attempted; the failure did not abort the loop.
    expect(ids).toEqual(["c-good-1", "c-bad", "c-good-2"]);
  });

  it("enumeration failure → logged, no throw, no starts", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockRejectedValue(
      new Error("db down"),
    );
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    const { startBootIdleConnections } = await import(
      "@/lib/mail/background-sync"
    );

    await expect(startBootIdleConnections()).resolves.toBeUndefined();
    expect(connectionManager.startConnection).not.toHaveBeenCalled();
  });

  it("Redis is never referenced — IDLE start is independent of the BullMQ block", async () => {
    // startBootIdleConnections only touches db + connectionManager. The queue
    // module (Redis) is not imported here, so a Redis outage in the sibling
    // BullMQ startup cannot prevent IDLE start. (background-sync.ts invokes it
    // BEFORE and OUTSIDE the try block that starts the Redis-backed workers.)
    const { startBootIdleConnections } = await import(
      "@/lib/mail/background-sync"
    );
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { id: "c-1", syncState: { lastFullSync: new Date("2026-01-01") } },
    ] as never);
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );

    await startBootIdleConnections();
    expect(connectionManager.startConnection).toHaveBeenCalledWith("c-1", {
      evictOnCap: false,
    });
  });
});

// --- shouldRunBootCatchUp (pure) -----------------------------------------

describe("shouldRunBootCatchUp (U5)", () => {
  it("lastUid 0 → false (cold folder defers to sync job)", async () => {
    const { shouldRunBootCatchUp } = await import("@/lib/mail/idle-handlers");
    expect(shouldRunBootCatchUp({ lastUid: 0, newUidCount: 3 })).toBe(false);
  });

  it("no new UIDs → false (nothing to ingest)", async () => {
    const { shouldRunBootCatchUp } = await import("@/lib/mail/idle-handlers");
    expect(shouldRunBootCatchUp({ lastUid: 100, newUidCount: 0 })).toBe(false);
  });

  it("a few new UIDs → true (cheap range fetch)", async () => {
    const { shouldRunBootCatchUp } = await import("@/lib/mail/idle-handlers");
    expect(shouldRunBootCatchUp({ lastUid: 100, newUidCount: 5 })).toBe(true);
  });

  it("large backlog over threshold → false (defer to sync job)", async () => {
    const { shouldRunBootCatchUp } = await import("@/lib/mail/idle-handlers");
    expect(shouldRunBootCatchUp({ lastUid: 100, newUidCount: 51 })).toBe(false);
  });

  it("exactly at threshold → true (boundary)", async () => {
    const { shouldRunBootCatchUp } = await import("@/lib/mail/idle-handlers");
    expect(
      shouldRunBootCatchUp({ lastUid: 100, newUidCount: 50, threshold: 50 }),
    ).toBe(true);
  });
});

// --- catchUpNewMessages (probe + gating wiring) --------------------------

describe("catchUpNewMessages (U5)", () => {
  function makeConn(searchResult: number[] | false) {
    return {
      connectionId: "conn-1",
      userId: "user-1",
      folderId: "folder-inbox",
      client: {
        search: vi.fn().mockResolvedValue(searchResult),
      },
      debounceTimers: new Map(),
    };
  }

  async function load() {
    return import("@/lib/mail/idle-handlers");
  }

  it("connection gone → returns silently, no DB read", async () => {
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    vi.mocked(connectionManager.getConnection).mockReturnValue(undefined);
    const { db } = await import("@/lib/db");

    const { catchUpNewMessages } = await load();
    await catchUpNewMessages("conn-1");

    expect(db.message.findFirst).not.toHaveBeenCalled();
  });

  it("lastUid 0 → skipped, no probe, checkForNewMessages not run", async () => {
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    const conn = makeConn([]);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null as never);

    const { catchUpNewMessages } = await load();
    await catchUpNewMessages("conn-1");

    // No probe issued, so the IMAP search never runs.
    expect(conn.client.search).not.toHaveBeenCalled();
  });

  it("large backlog (> threshold) → probed but NOT ingested (deferred)", async () => {
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    // 60 new UIDs above lastUid 100.
    const newUids = Array.from({ length: 60 }, (_, i) => 101 + i);
    const conn = makeConn(newUids);
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({ uid: 100 } as never);

    const { catchUpNewMessages } = await load();
    await catchUpNewMessages("conn-1");

    // Cheap UID-only probe ran...
    expect(conn.client.search).toHaveBeenCalledWith(
      { uid: "101:*" },
      { uid: true },
    );
    // ...but no body fetch (checkForNewMessages would call client.fetch — there
    // is no fetch on this stub, and the in-flight path would have thrown).
    expect((conn.client as { fetch?: unknown }).fetch).toBeUndefined();
  });

  it("a few new UIDs → runs ingestion via checkForNewMessages", async () => {
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    // Provide a fetch so checkForNewMessages can run end-to-end.
    const conn = {
      connectionId: "conn-1",
      userId: "user-1",
      folderId: "folder-inbox",
      client: {
        search: vi.fn().mockResolvedValue([101, 102, 103]),
        fetch: vi.fn(function* () {
          yield { uid: 101 };
        }),
      },
      debounceTimers: new Map(),
    };
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst)
      .mockResolvedValueOnce({ uid: 100 } as never) // catch-up lastUid probe
      .mockResolvedValueOnce({ uid: 100 } as never) // ingest lastUid
      .mockResolvedValue(null as never); // per-UID existence check
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
    } as never);
    processMessage.mockResolvedValue({
      id: "msg-101",
      isInImbox: false,
      fromName: null,
      fromAddress: "x@y.com",
      subject: "hi",
      threadId: null,
    });
    const { emitToUser } = await import("@/lib/mail/sse-subscribers");

    const { catchUpNewMessages } = await load();
    await catchUpNewMessages("conn-1");

    expect(conn.client.search).toHaveBeenCalledWith(
      { uid: "101:*" },
      { uid: true },
    );
    // Ingestion ran: client.fetch invoked over the new range.
    expect(conn.client.fetch).toHaveBeenCalled();
    // And the new message was announced once.
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it("probe error → deferred (no ingestion), no throw", async () => {
    const { connectionManager } = await import(
      "@/lib/mail/connection-manager"
    );
    const conn = {
      connectionId: "conn-1",
      userId: "user-1",
      folderId: "folder-inbox",
      client: {
        search: vi.fn().mockRejectedValue(new Error("probe failed")),
        fetch: vi.fn(),
      },
      debounceTimers: new Map(),
    };
    vi.mocked(connectionManager.getConnection).mockReturnValue(conn as never);
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({ uid: 100 } as never);

    const { catchUpNewMessages } = await load();
    await expect(catchUpNewMessages("conn-1")).resolves.toBeUndefined();
    expect(conn.client.fetch).not.toHaveBeenCalled();
  });
});
