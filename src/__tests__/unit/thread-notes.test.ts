import { describe, it, expect, vi, beforeEach } from "vitest";
import { threadNoteKey } from "@/lib/mail/thread-note";
import { saveThreadNoteForUser } from "@/lib/mail/thread-notes";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findFirst: vi.fn() },
    threadNote: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("threadNoteKey", () => {
  it("uses threadId when the message is grouped, else the message id", () => {
    expect(threadNoteKey({ id: "m1", threadId: "t1" })).toBe("t1");
    expect(threadNoteKey({ id: "m1", threadId: null })).toBe("m1");
  });
});

describe("saveThreadNoteForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a thread the user does not own", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    await expect(
      saveThreadNoteForUser("u1", "t1", "follow up Tuesday"),
    ).rejects.toThrow("Thread not found");
    expect(db.threadNote.upsert).not.toHaveBeenCalled();
  });

  it("upserts a trimmed body for an owned thread", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({ id: "m1" } as never);
    vi.mocked(db.threadNote.upsert).mockResolvedValue({} as never);

    await saveThreadNoteForUser("u1", "t1", "  follow up Tuesday  ");

    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", OR: [{ threadId: "t1" }, { id: "t1" }] },
      select: { id: true },
    });
    expect(db.threadNote.upsert).toHaveBeenCalledWith({
      where: { userId_threadId: { userId: "u1", threadId: "t1" } },
      create: { userId: "u1", threadId: "t1", body: "follow up Tuesday" },
      update: { body: "follow up Tuesday" },
    });
  });

  it("deletes the row when the note is cleared", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({ id: "m1" } as never);
    vi.mocked(db.threadNote.deleteMany).mockResolvedValue({ count: 1 } as never);

    await saveThreadNoteForUser("u1", "t1", "   ");

    expect(db.threadNote.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", threadId: "t1" },
    });
    expect(db.threadNote.upsert).not.toHaveBeenCalled();
  });
});
