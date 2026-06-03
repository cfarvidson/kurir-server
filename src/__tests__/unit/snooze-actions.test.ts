import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

// The snooze/wake path must treat read state as orthogonal to snooze state:
// snoozing must not mark mail read, and waking must not mark it unread. This
// guarantees only genuinely unread mail surfaces as unread ("new").
describe("snooze actions preserve read state", () => {
  beforeEach(() => vi.clearAllMocks());

  async function authedUser(id = "user-1") {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id } } as never);
  }

  async function updateData() {
    const { db } = await import("@/lib/db");
    return vi.mocked(db.message.updateMany).mock.calls[0][0].data;
  }

  it("snoozeConversation sets snooze fields and does not touch isRead", async () => {
    await authedUser();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const until = new Date(Date.now() + 60_000);
    const { snoozeConversation } = await import("@/actions/snooze");
    await snoozeConversation("m1", until);

    const data = await updateData();
    expect(data).toEqual({ isSnoozed: true, snoozedUntil: until });
    expect(data).not.toHaveProperty("isRead");
  });

  it("snoozeConversations (bulk) does not touch isRead", async () => {
    await authedUser();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany)
      .mockResolvedValueOnce([{ id: "m1", threadId: null }] as never)
      .mockResolvedValueOnce([{ id: "m1" }] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const until = new Date(Date.now() + 60_000);
    const { snoozeConversations } = await import("@/actions/snooze");
    await snoozeConversations(["m1"], until);

    const data = await updateData();
    expect(data).toEqual({ isSnoozed: true, snoozedUntil: until });
    expect(data).not.toHaveProperty("isRead");
  });

  it("unsnoozeConversation clears snooze fields and does not touch isRead", async () => {
    await authedUser();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { unsnoozeConversation } = await import("@/actions/snooze");
    await unsnoozeConversation("m1");

    const data = await updateData();
    expect(data).toEqual({ isSnoozed: false, snoozedUntil: null });
    expect(data).not.toHaveProperty("isRead");
  });
});
