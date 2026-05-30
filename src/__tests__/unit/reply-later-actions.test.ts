import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

describe("setReplyLater", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { setReplyLater } = await import("@/actions/reply-later");
    await expect(setReplyLater("m1")).rejects.toThrow("Unauthorized");
  });

  it("throws when the message is not owned by the user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { setReplyLater } = await import("@/actions/reply-later");
    await expect(setReplyLater("m1")).rejects.toThrow("Message not found");
    expect(db.message.updateMany).not.toHaveBeenCalled();
  });

  it("flags every message in the thread and revalidates", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: "t1",
    } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
    ] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never);

    const { updateTag } = await import("next/cache");
    const { setReplyLater } = await import("@/actions/reply-later");
    await setReplyLater("m1");

    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: { isReplyLater: true },
    });
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("sidebar-counts");
  });
});

describe("clearReplyLater", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the flag for the whole thread", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { clearReplyLater } = await import("@/actions/reply-later");
    await clearReplyLater("m1");

    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] } },
      data: { isReplyLater: false },
    });
  });
});
