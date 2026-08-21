import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { updateMany: vi.fn() },
    emailConnection: { findMany: vi.fn() },
    sender: { findMany: vi.fn(), updateMany: vi.fn() },
    calendarTombstone: { deleteMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

describe("wakeExpiredSnoozes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears snooze fields without touching read state", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 3 } as never);

    const { wakeExpiredSnoozes } = await import("@/lib/jobs/maintenance-tasks");
    const count = await wakeExpiredSnoozes("user-1");

    expect(count).toBe(3);
    expect(db.message.updateMany).toHaveBeenCalledTimes(1);

    const call = vi.mocked(db.message.updateMany).mock.calls[0][0];
    // Targets only expired, still-snoozed messages for this user.
    const where = call.where as {
      userId: string;
      isSnoozed: boolean;
      snoozedUntil: unknown;
    };
    expect(where).toMatchObject({
      userId: "user-1",
      isSnoozed: true,
    });
    expect(where.snoozedUntil).toHaveProperty("lte");
    // Wakes the snooze but preserves read state — a read message must not
    // reappear as unread ("new") when its snooze expires.
    expect(call.data).toEqual({ isSnoozed: false, snoozedUntil: null });
    expect(call.data).not.toHaveProperty("isRead");
  });
});

describe("checkExpiredFollowUps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the affected-row count from $executeRawUnsafe", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);
    vi.mocked(db.$executeRawUnsafe).mockResolvedValue(3 as never);

    const { checkExpiredFollowUps } = await import("@/lib/jobs/maintenance-tasks");
    const count = await checkExpiredFollowUps("user-1");

    expect(count).toBe(3);
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe("approveOwnPendingSenders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0 and skips sender queries when the user has no own addresses", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);

    const { approveOwnPendingSenders } = await import(
      "@/lib/jobs/maintenance-tasks"
    );
    const count = await approveOwnPendingSenders("user-1");

    expect(count).toBe(0);
    expect(db.sender.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 0 and skips the transaction when no PENDING ghosts match", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
    ] as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([] as never);

    const { approveOwnPendingSenders } = await import(
      "@/lib/jobs/maintenance-tasks"
    );
    const count = await approveOwnPendingSenders("user-1");

    expect(count).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("approves matching ghost senders and reclassifies their non-archived messages into Imbox", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([
      { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
    ] as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "sender-1" },
      { id: "sender-2" },
    ] as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const { approveOwnPendingSenders } = await import(
      "@/lib/jobs/maintenance-tasks"
    );
    const count = await approveOwnPendingSenders("user-1");

    expect(count).toBe(2);
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    const ops = vi.mocked(db.$transaction).mock.calls[0][0] as unknown as {
      then: unknown;
    }[];
    expect(ops).toHaveLength(2);

    // sender.updateMany was called with the exact ghost ids and target status.
    expect(db.sender.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sender-1", "sender-2"] } },
      data: expect.objectContaining({
        status: "APPROVED",
        category: "IMBOX",
      }),
    });

    // message.updateMany reclassifies non-archived messages into Imbox only.
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: {
        senderId: { in: ["sender-1", "sender-2"] },
        isArchived: false,
      },
      data: {
        isInScreener: false,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
      },
    });
  });
});

describe("pruneCalendarTombstones", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes calendar tombstones older than 30 days", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.calendarTombstone.deleteMany).mockResolvedValue({
      count: 4,
    } as never);

    const before = Date.now();
    const { pruneCalendarTombstones } = await import(
      "@/lib/jobs/maintenance-tasks"
    );
    const count = await pruneCalendarTombstones();
    const after = Date.now();

    expect(count).toBe(4);
    const call = vi.mocked(db.calendarTombstone.deleteMany).mock.calls[0][0]!;
    const cutoff = (call.where as { deletedAt: { lt: Date } }).deletedAt.lt;
    const day = 24 * 60 * 60_000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 30 * day);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - 30 * day);
  });
});
