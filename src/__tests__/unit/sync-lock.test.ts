import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    syncState: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("sync-lock", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe("isSyncLockHeld", () => {
    it("returns true for a fresh isSyncing lock", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        isSyncing: true,
        syncStartedAt: new Date(),
      } as never);

      const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
      expect(await isSyncLockHeld("c1")).toBe(true);
    });

    it("returns false when isSyncing is false", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        isSyncing: false,
        syncStartedAt: new Date(),
      } as never);

      const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
      expect(await isSyncLockHeld("c1")).toBe(false);
    });

    it("returns false when isSyncing is true but the lock is stale", async () => {
      const { db } = await import("@/lib/db");
      const { STALE_LOCK_MS, isSyncLockHeld } = await import(
        "@/lib/mail/sync-lock"
      );
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        isSyncing: true,
        // Older than the stale window -> reads as NOT held.
        syncStartedAt: new Date(Date.now() - STALE_LOCK_MS - 1000),
      } as never);

      expect(await isSyncLockHeld("c1")).toBe(false);
    });

    it("returns false when there is no SyncState row", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.findUnique).mockResolvedValue(null as never);

      const { isSyncLockHeld } = await import("@/lib/mail/sync-lock");
      expect(await isSyncLockHeld("c1")).toBe(false);
    });

    it("returns true at the exact stale boundary", async () => {
      const { db } = await import("@/lib/db");
      const now = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const { STALE_LOCK_MS, isSyncLockHeld } = await import(
        "@/lib/mail/sync-lock"
      );
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        isSyncing: true,
        syncStartedAt: new Date(now - STALE_LOCK_MS),
      } as never);

      // >= boundary counts as held.
      expect(await isSyncLockHeld("c1")).toBe(true);
    });
  });

  describe("claimSyncLock", () => {
    it("ensures the row exists then atomically claims, returning true when it wins", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.upsert).mockResolvedValue({} as never);
      vi.mocked(db.syncState.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { claimSyncLock } = await import("@/lib/mail/sync-lock");
      expect(await claimSyncLock("c1")).toBe(true);

      expect(db.syncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { emailConnectionId: "c1" } }),
      );
      const updateArg = vi.mocked(db.syncState.updateMany).mock.calls[0][0];
      expect(updateArg.where).toMatchObject({ emailConnectionId: "c1" });
      expect(updateArg.where?.OR).toHaveLength(2);
      expect(updateArg.data).toMatchObject({
        isSyncing: true,
        syncError: null,
      });
    });

    it("returns false when the claim updates zero rows (lock held by another)", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.upsert).mockResolvedValue({} as never);
      vi.mocked(db.syncState.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      const { claimSyncLock } = await import("@/lib/mail/sync-lock");
      expect(await claimSyncLock("c1")).toBe(false);
    });

    it("atomically wins exactly once under two concurrent claims", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.syncState.upsert).mockResolvedValue({} as never);
      // Simulate the DB-level atomicity: the first updateMany flips the row and
      // affects 1 row; the second sees it already syncing and affects 0.
      vi.mocked(db.syncState.updateMany)
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never);

      const { claimSyncLock } = await import("@/lib/mail/sync-lock");
      const [a, b] = await Promise.all([
        claimSyncLock("c1"),
        claimSyncLock("c1"),
      ]);

      expect([a, b].filter(Boolean)).toHaveLength(1);
    });
  });

  describe("releaseSyncLock", () => {
    it("sets lastFullSync on success and logs hold duration", async () => {
      const { db } = await import("@/lib/db");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const startedAt = new Date(Date.now() - 1234);
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        syncStartedAt: startedAt,
      } as never);
      vi.mocked(db.syncState.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseSyncLock } = await import("@/lib/mail/sync-lock");
      await releaseSyncLock("c1", undefined, "some log");

      const data = vi.mocked(db.syncState.updateMany).mock.calls[0][0].data;
      expect(data).toMatchObject({
        isSyncing: false,
        syncError: null,
        lastSyncLog: "some log",
      });
      expect(data).toHaveProperty("lastFullSync");
      expect((data as { lastFullSync?: unknown }).lastFullSync).toBeInstanceOf(
        Date,
      );

      // Hold duration logged once.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("c1");
      expect(logSpy.mock.calls[0][0]).toMatch(/after \d+ms/);
    });

    it("does NOT set lastFullSync on error and records the error/log", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        syncStartedAt: new Date(),
      } as never);
      vi.mocked(db.syncState.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseSyncLock } = await import("@/lib/mail/sync-lock");
      await releaseSyncLock("c1", "boom");

      const data = vi.mocked(db.syncState.updateMany).mock.calls[0][0].data;
      expect(data).toMatchObject({
        isSyncing: false,
        syncError: "boom",
        lastSyncLog: null,
      });
      expect(data).not.toHaveProperty("lastFullSync");
    });

    it("does not log a hold duration when syncStartedAt is missing", async () => {
      const { db } = await import("@/lib/db");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(db.syncState.findUnique).mockResolvedValue({
        syncStartedAt: null,
      } as never);
      vi.mocked(db.syncState.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseSyncLock } = await import("@/lib/mail/sync-lock");
      await releaseSyncLock("c1", undefined, "log");

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
