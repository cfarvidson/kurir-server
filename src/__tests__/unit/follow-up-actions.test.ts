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

describe("setFollowUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { setFollowUp } = await import("@/actions/follow-up");
    await expect(
      setFollowUp("m1", new Date(Date.now() + 86400000)),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects a deadline in the past", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { setFollowUp } = await import("@/actions/follow-up");
    await expect(
      setFollowUp("m1", new Date(Date.now() - 1000)),
    ).rejects.toThrow("Follow-up date must be in the future");
  });

  it("sets the deadline for the whole thread with isFollowUp=false", async () => {
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

    const until = new Date(Date.now() + 86400000);
    const { updateTag } = await import("next/cache");
    const { setFollowUp } = await import("@/actions/follow-up");
    await setFollowUp("m1", until);

    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: { followUpAt: until, followUpSetAt: expect.any(Date), isFollowUp: false },
    });
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("sidebar-counts");
  });
});

describe("dismissFollowUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears follow-up state for the whole thread", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { dismissFollowUp } = await import("@/actions/follow-up");
    await dismissFollowUp("m1");

    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] } },
      data: { followUpAt: null, followUpSetAt: null, isFollowUp: false },
    });
  });
});
