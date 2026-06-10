import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
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

// ---------------------------------------------------------------------------
// moveToArchiveViaImap: Undo correctness on both sides of the deferred move
// ---------------------------------------------------------------------------

type FakeClient = {
  list: ReturnType<typeof vi.fn>;
  getMailboxLock: ReturnType<typeof vi.fn>;
  messageMove: ReturnType<typeof vi.fn>;
};

/**
 * Build a fake ImapFlow client and wire `withImapConnection` to invoke its
 * callback with that client (mirroring the real helper, which returns whatever
 * the callback returns, or null on connection failure).
 */
async function wireImap(opts: {
  archiveBox?: { path: string };
  moveResults?: Array<{ uidMap?: Map<number, number> } | false>;
}) {
  const { withImapConnection, findArchiveMailbox } = await import(
    "@/lib/mail/imap-client"
  );
  const lock = { release: vi.fn() };
  const moveResults = opts.moveResults ?? [];
  let moveCall = 0;
  const client: FakeClient = {
    list: vi.fn().mockResolvedValue([]),
    getMailboxLock: vi.fn().mockResolvedValue(lock),
    messageMove: vi.fn().mockImplementation(async () => {
      const r = moveResults[moveCall] ?? false;
      moveCall += 1;
      return r;
    }),
  };
  vi.mocked(findArchiveMailbox).mockReturnValue(
    (opts.archiveBox ?? undefined) as never,
  );
  vi.mocked(withImapConnection).mockImplementation(
    async (_connId, fn) => fn(client as never) as never,
  );
  return { client, lock };
}

describe("moveToArchiveViaImap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("all still archived: moves all UIDs and persists rows from uidMap", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 10 },
      { id: "m2", uid: 11 },
    ] as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "archive-folder",
    } as never);
    vi.mocked(db.message.update).mockResolvedValue({} as never);

    const { client } = await wireImap({
      archiveBox: { path: "Archive" },
      moveResults: [
        {
          uidMap: new Map([
            [10, 100],
            [11, 101],
          ]),
        },
      ],
    });

    const { suppressEcho } = await import("@/lib/mail/flag-push");
    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    await moveToArchiveViaImap("user-1", "c1", "inbox-folder", [10, 11]);

    // Move issued for the still-archived UIDs.
    expect(client.messageMove).toHaveBeenCalledTimes(1);
    expect(client.messageMove).toHaveBeenCalledWith([10, 11], "Archive", {
      uid: true,
    });

    // Echo suppression for each moved UID.
    expect(suppressEcho).toHaveBeenCalledTimes(2);
    expect(suppressEcho).toHaveBeenCalledWith("user-1", "inbox-folder", 10);
    expect(suppressEcho).toHaveBeenCalledWith("user-1", "inbox-folder", 11);

    // Rows repointed to the archive folder with destination UIDs.
    expect(db.message.update).toHaveBeenCalledTimes(2);
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { folderId: "archive-folder", uid: 100 },
    });
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { folderId: "archive-folder", uid: 101 },
    });
  });

  it("undo before move (empty set): no IMAP call and no suppression", async () => {
    const { db } = await import("@/lib/db");
    // All candidates have been un-archived → none still archived.
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);

    const { withImapConnection } = await import("@/lib/mail/imap-client");
    const { suppressEcho } = await import("@/lib/mail/flag-push");

    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    await moveToArchiveViaImap("user-1", "c1", "inbox-folder", [10, 11]);

    expect(suppressEcho).not.toHaveBeenCalled();
    expect(withImapConnection).not.toHaveBeenCalled();
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it("partial undo in a multi-message thread: only still-archived UIDs move + suppress", async () => {
    const { db } = await import("@/lib/db");
    // Of [10, 11, 12], only 11 is still archived.
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m2", uid: 11 },
    ] as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "archive-folder",
    } as never);
    vi.mocked(db.message.update).mockResolvedValue({} as never);

    const { client } = await wireImap({
      archiveBox: { path: "Archive" },
      moveResults: [{ uidMap: new Map([[11, 111]]) }],
    });

    const { suppressEcho } = await import("@/lib/mail/flag-push");
    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    await moveToArchiveViaImap("user-1", "c1", "inbox-folder", [10, 11, 12]);

    expect(client.messageMove).toHaveBeenCalledWith([11], "Archive", {
      uid: true,
    });
    expect(suppressEcho).toHaveBeenCalledTimes(1);
    expect(suppressEcho).toHaveBeenCalledWith("user-1", "inbox-folder", 11);
    expect(db.message.update).toHaveBeenCalledTimes(1);
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { folderId: "archive-folder", uid: 111 },
    });
  });

  it("post-move undo precondition: rows carry archive folder + dest UID for the reverse move", async () => {
    // After the deferred move, the row's folderId/uid identify the archive
    // folder, which is exactly what unarchiveConversation reads to compute its
    // reverse IMAP move. Assert the uidMap-derived persistence.
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 7 },
    ] as never);
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      id: "archive-folder",
    } as never);
    vi.mocked(db.message.update).mockResolvedValue({} as never);

    await wireImap({
      archiveBox: { path: "Archive" },
      moveResults: [{ uidMap: new Map([[7, 700]]) }],
    });

    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    await moveToArchiveViaImap("user-1", "c1", "inbox-folder", [7]);

    // Destination archive folder resolved by IMAP path.
    expect(db.folder.findFirst).toHaveBeenCalledWith({
      where: { emailConnectionId: "c1", path: "Archive" },
      select: { id: true },
    });
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { folderId: "archive-folder", uid: 700 },
    });
  });

  it("no uidMap returned: rows untouched, warning logged, no crash", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 9 },
    ] as never);
    vi.mocked(db.message.update).mockResolvedValue({} as never);

    // messageMove returns `false` (server without UIDPLUS / failed batch).
    const { client } = await wireImap({
      archiveBox: { path: "Archive" },
      moveResults: [false],
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
    await expect(
      moveToArchiveViaImap("user-1", "c1", "inbox-folder", [9]),
    ).resolves.toBeUndefined();

    // Move was attempted, but no row update and no folder lookup happened.
    expect(client.messageMove).toHaveBeenCalledTimes(1);
    expect(db.folder.findFirst).not.toHaveBeenCalled();
    expect(db.message.update).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
