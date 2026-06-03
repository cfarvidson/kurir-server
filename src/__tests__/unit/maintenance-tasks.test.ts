import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { updateMany: vi.fn() },
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
