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
    });
  });

  it("excludes archived messages from the reply-later list", async () => {
    expect(await capturedWhere("reply-later")).toEqual({
      userId: "user-1",
      isReplyLater: true,
      isArchived: false,
    });
  });

  it("still excludes snoozed messages from the imbox list", async () => {
    expect(await capturedWhere("imbox")).toEqual({
      userId: "user-1",
      isInImbox: true,
      isSnoozed: false,
      isReplyLater: false,
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
});
