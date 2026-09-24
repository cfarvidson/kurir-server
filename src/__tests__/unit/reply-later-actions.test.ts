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
    folder: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));

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
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("unarchives an archived thread into its category before flagging (plan 056)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst)
      // setThreadReplyLater's own lookup
      .mockResolvedValueOnce({ id: "m1", threadId: "t1", isArchived: true } as never)
      // unarchiveThread's findThreadMessages
      .mockResolvedValueOnce({
        id: "m1",
        threadId: "t1",
        emailConnectionId: "c1",
        uid: 5,
        folderId: "f1",
        sender: { category: "FEED" },
      } as never);
    vi.mocked(db.message.findMany)
      // thread rows for unarchive
      .mockResolvedValueOnce([{ id: "m1", uid: 5, folderId: "f1" }] as never)
      // no subject-rule placements
      .mockResolvedValueOnce([] as never)
      // thread rows for the flag
      .mockResolvedValueOnce([{ id: "m1" }] as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue(null); // no archive folder -> no IMAP move
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const { setReplyLater } = await import("@/actions/reply-later");
    await setReplyLater("m1");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] }, userId: "user-1" },
      data: {
        isArchived: false,
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
        isInScreener: false,
      },
    });
    expect(db.message.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ["m1"] } },
      data: { isReplyLater: true },
    });
  });
});

describe("clearReplyLater", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves an archived thread archived", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
      isArchived: true,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { clearReplyLater } = await import("@/actions/reply-later");
    await clearReplyLater("m1");

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.message.updateMany).toHaveBeenCalledTimes(1);
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] } },
      data: { isReplyLater: false },
    });
  });

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
