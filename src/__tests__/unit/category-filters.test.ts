import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { message: { findMany: vi.fn() } },
}));

vi.mock("@/lib/mail/threads", () => ({
  getThreadCounts: vi.fn().mockResolvedValue(new Map()),
}));

// getMessages applies CATEGORY_FILTERS into the Prisma `where` clause. Asserting
// the captured `where` is the public-surface way to pin the archived-exclusion
// invariant without exporting the module-private filter map.
describe("getMessages category filters", () => {
  beforeEach(() => vi.clearAllMocks());

  async function capturedWhere(category: string) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const { getMessages } = await import("@/lib/mail/messages");
    await getMessages("user-1", category as never, 50);
    return vi.mocked(db.message.findMany).mock.calls[0][0]?.where;
  }

  it("excludes archived messages from the follow-up list", async () => {
    expect(await capturedWhere("follow-up")).toEqual({
      userId: "user-1",
      isFollowUp: true,
      isArchived: false,
      isDeleted: false,
    });
  });

  it("excludes archived messages from the reply-later list", async () => {
    expect(await capturedWhere("reply-later")).toEqual({
      userId: "user-1",
      isReplyLater: true,
      isArchived: false,
      isDeleted: false,
    });
  });

  it("still excludes snoozed messages from the imbox list", async () => {
    expect(await capturedWhere("imbox")).toEqual({
      userId: "user-1",
      isInImbox: true,
      isSnoozed: false,
      isReplyLater: false,
      isDeleted: false,
    });
  });

  it("excludes reply-later messages from imbox, feed, and paper trail", async () => {
    for (const category of ["imbox", "feed", "paper-trail"]) {
      expect(await capturedWhere(category)).toMatchObject({
        isReplyLater: false,
      });
      vi.clearAllMocks();
    }
  });

  it("filters Sent by specialUse or a path that contains sent", async () => {
    const where = await capturedWhere("sent");
    expect(where).toEqual({
      userId: "user-1",
      isDeleted: false,
      OR: [
        { folder: { specialUse: "sent" } },
        { folder: { path: { contains: "sent", mode: "insensitive" } } },
      ],
    });
  });

  it("orders Sent chronologically like archive", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const { getMessages } = await import("@/lib/mail/messages");
    await getMessages("user-1", "sent" as never, 50);
    expect(vi.mocked(db.message.findMany).mock.calls[0][0]?.orderBy).toEqual([
      { receivedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("returns an empty Sent page when no folder matches", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const { getMessages } = await import("@/lib/mail/messages");
    await expect(getMessages("user-1", "sent" as never, 50)).resolves.toEqual({
      messages: [],
      nextCursor: null,
    });
  });
});
