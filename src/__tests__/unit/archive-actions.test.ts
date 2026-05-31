import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    folder: { findFirst: vi.fn() },
    sender: { updateMany: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/mail/imap-client", () => ({
  withImapConnection: vi.fn(),
  findArchiveMailbox: vi.fn(),
}));
vi.mock("@/lib/mail/flag-push", () => ({ suppressEcho: vi.fn() }));

describe("archiveConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears reply-later and follow-up state when archiving", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
      emailConnectionId: "c1",
      uid: 5,
      folderId: "f1",
    } as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue(null); // no inbox -> skip IMAP
    vi.mocked(db.message.findMany).mockResolvedValue([] as never); // autoReject: no senders
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { archiveConversation } = await import("@/actions/archive");
    await archiveConversation("m1");

    expect(db.message.updateMany).toHaveBeenCalledTimes(1);
    const data = vi.mocked(db.message.updateMany).mock.calls[0][0].data;
    expect(data).toMatchObject({
      isArchived: true,
      isReplyLater: false,
      isFollowUp: false,
      followUpAt: null,
      followUpSetAt: null,
      isSnoozed: false,
      snoozedUntil: null,
    });

    // Follow Up / Reply Later list caches are invalidated.
    const { revalidatePath } = await import("next/cache");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/reply-later");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/follow-up");
  });
});
