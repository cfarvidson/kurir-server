import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    calendarAccount: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("calendar sync-lock", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe("claimCalendarSyncLock", () => {
    it("atomically claims and returns true when it wins", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { claimCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      expect(await claimCalendarSyncLock("a1")).toBe(true);

      const updateArg = vi.mocked(db.calendarAccount.updateMany).mock
        .calls[0][0];
      expect(updateArg.where).toMatchObject({ id: "a1" });
      expect(updateArg.where?.OR).toHaveLength(2);
      expect(updateArg.data).toMatchObject({
        isSyncing: true,
        lastError: null,
      });
      expect(updateArg.data).toHaveProperty("syncLockAt");
      expect(updateArg.data).toHaveProperty("syncLockToken");
    });

    it("returns false when the claim updates zero rows (lock held by another)", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      const { claimCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      expect(await claimCalendarSyncLock("a1")).toBe(false);
    });

    it("atomically wins exactly once under two concurrent claims", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany)
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never);

      const { claimCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      const [a, b] = await Promise.all([
        claimCalendarSyncLock("a1"),
        claimCalendarSyncLock("a1"),
      ]);

      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it("claims when isSyncing is false or syncLockAt is stale", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { STALE_LOCK_MS, claimCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await claimCalendarSyncLock("a1");

      const updateArg = vi.mocked(db.calendarAccount.updateMany).mock
        .calls[0][0];
      const or = updateArg.where?.OR as Array<Record<string, unknown>>;
      expect(or).toEqual(
        expect.arrayContaining([
          { isSyncing: false },
          {
            syncLockAt: {
              lt: expect.any(Date),
            },
          },
        ]),
      );
      const stale = or.find((clause) => "syncLockAt" in clause) as {
        syncLockAt: { lt: Date };
      };
      const ageMs = Date.now() - stale.syncLockAt.lt.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(STALE_LOCK_MS - 50);
      expect(ageMs).toBeLessThanOrEqual(STALE_LOCK_MS + 50);
    });
  });

  describe("heartbeatCalendarSyncLock", () => {
    it("refreshes syncLockAt while isSyncing", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { heartbeatCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await heartbeatCalendarSyncLock("a1");

      expect(db.calendarAccount.updateMany).toHaveBeenCalledWith({
        where: { id: "a1", isSyncing: true },
        data: { syncLockAt: expect.any(Date) },
      });
    });

    it("swallows update errors (best-effort)", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.calendarAccount.updateMany).mockRejectedValue(
        new Error("db down"),
      );

      const { heartbeatCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await expect(heartbeatCalendarSyncLock("a1")).resolves.toBeUndefined();
    });
  });

  describe("releaseCalendarSyncLock", () => {
    it("sets lastSyncedAt on success and clears lastError", async () => {
      const { db } = await import("@/lib/db");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const lockedAt = new Date(Date.now() - 1234);
      vi.mocked(db.calendarAccount.findUnique).mockResolvedValue({
        syncLockAt: lockedAt,
      } as never);
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await releaseCalendarSyncLock("a1");

      const data = vi.mocked(db.calendarAccount.updateMany).mock.calls[0][0]
        .data;
      expect(data).toMatchObject({
        isSyncing: false,
        lastError: null,
      });
      expect(data).toHaveProperty("lastSyncedAt");
      expect(
        (data as { lastSyncedAt?: unknown }).lastSyncedAt,
      ).toBeInstanceOf(Date);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("a1");
      expect(logSpy.mock.calls[0][0]).toMatch(/after \d+ms/);
    });

    it("sets lastError on failure and does not advance lastSyncedAt", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(db.calendarAccount.findUnique).mockResolvedValue({
        syncLockAt: new Date(),
      } as never);
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await releaseCalendarSyncLock("a1", "boom");

      const data = vi.mocked(db.calendarAccount.updateMany).mock.calls[0][0]
        .data;
      expect(data).toMatchObject({
        isSyncing: false,
        lastError: "boom",
      });
      expect(data).not.toHaveProperty("lastSyncedAt");
    });

    it("does not log a hold duration when syncLockAt is missing", async () => {
      const { db } = await import("@/lib/db");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(db.calendarAccount.findUnique).mockResolvedValue({
        syncLockAt: null,
      } as never);
      vi.mocked(db.calendarAccount.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      const { releaseCalendarSyncLock } = await import(
        "@/lib/calendar/sync-lock"
      );
      await releaseCalendarSyncLock("a1");

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
