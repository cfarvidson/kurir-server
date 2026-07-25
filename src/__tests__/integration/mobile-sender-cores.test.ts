/**
 * Behavioral tests for the sender-screener mutation cores in
 * src/lib/mail/mutations.ts. These exercise the DB writes directly with a
 * mocked Prisma client (no cache layer, no IMAP).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
  sender: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  folder: { findFirst: vi.fn() },
  message: { updateMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown) => ops),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
// Cut heavy transitive import chains that the cores file pulls in.
vi.mock("@/lib/mail/archive-imap", () => ({
  moveToArchiveViaImap: vi.fn(),
  moveToInboxViaImap: vi.fn(),
}));
vi.mock("@/actions/contacts", () => ({ findOrCreateContactForEmail: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(async (ops: unknown) => ops);
});

describe("skipSenderForUser / unskipSenderForUser", () => {
  it("skip sets skippedUntil roughly 24h out", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: USER });
    const { skipSenderForUser } = await import("@/lib/mail/mutations");

    const before = Date.now();
    await skipSenderForUser(USER, "s1");
    const after = Date.now();

    expect(dbMock.sender.update).toHaveBeenCalledTimes(1);
    const arg = dbMock.sender.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "s1" });
    const until = (arg.data.skippedUntil as Date).getTime();
    const day = 24 * 60 * 60 * 1000;
    expect(until).toBeGreaterThanOrEqual(before + day - 1000);
    expect(until).toBeLessThanOrEqual(after + day + 1000);
  });

  it("unskip clears skippedUntil", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: USER });
    const { unskipSenderForUser } = await import("@/lib/mail/mutations");

    await unskipSenderForUser(USER, "s1");

    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { skippedUntil: null },
    });
  });

  it("throws when the sender belongs to another user", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: "someone-else" });
    const { skipSenderForUser } = await import("@/lib/mail/mutations");
    await expect(skipSenderForUser(USER, "s1")).rejects.toThrow(
      "Sender not found",
    );
    expect(dbMock.sender.update).not.toHaveBeenCalled();
  });
});

describe("undoScreenActionForUser", () => {
  it("reverts an APPROVED sender to PENDING and moves inbox mail back to the screener", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      status: "APPROVED",
      emailConnectionId: "c1",
    });
    dbMock.folder.findFirst.mockResolvedValue({ id: "inbox-1" });
    const { undoScreenActionForUser } = await import("@/lib/mail/mutations");

    await undoScreenActionForUser(USER, "s1");

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "PENDING", category: null, decidedAt: null },
    });
    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { senderId: "s1", folderId: "inbox-1" },
      data: {
        isArchived: false,
        isInScreener: true,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
      },
    });
  });

  it("is a no-op when the sender is already PENDING", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      status: "PENDING",
      emailConnectionId: "c1",
    });
    const { undoScreenActionForUser } = await import("@/lib/mail/mutations");

    await undoScreenActionForUser(USER, "s1");

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.folder.findFirst).not.toHaveBeenCalled();
  });
});

describe("changeSenderCategoryForUser", () => {
  it("moves non-archived messages into the new category when APPROVED", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      status: "APPROVED",
    });
    const { changeSenderCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );

    await changeSenderCategoryForUser(USER, "s1", "FEED");

    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { category: "FEED" },
    });
    expect(dbMock.message.updateMany).toHaveBeenCalledWith({
      where: { senderId: "s1", isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
      },
    });
  });

  it("throws when the sender is not APPROVED", async () => {
    dbMock.sender.findUnique.mockResolvedValue({
      userId: USER,
      status: "PENDING",
    });
    const { changeSenderCategoryForUser } = await import(
      "@/lib/mail/mutations"
    );
    await expect(
      changeSenderCategoryForUser(USER, "s1", "IMBOX"),
    ).rejects.toThrow("Sender must be approved first");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("setSenderUnthreadForUser", () => {
  it("writes the unthread flag", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: USER });
    const { setSenderUnthreadForUser } = await import("@/lib/mail/mutations");

    await setSenderUnthreadForUser(USER, "s1", true);

    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { unthread: true },
    });
  });
});

describe("setSenderAllowImagesForUser", () => {
  it("writes the allowRemoteImages flag", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: USER });
    const { setSenderAllowImagesForUser } = await import(
      "@/lib/mail/mutations"
    );

    await setSenderAllowImagesForUser(USER, "s1", true);

    expect(dbMock.sender.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { allowRemoteImages: true },
    });
  });

  it("throws when the sender belongs to another user", async () => {
    dbMock.sender.findUnique.mockResolvedValue({ userId: "someone-else" });
    const { setSenderAllowImagesForUser } = await import(
      "@/lib/mail/mutations"
    );
    await expect(
      setSenderAllowImagesForUser(USER, "s1", true),
    ).rejects.toThrow("Sender not found");
    expect(dbMock.sender.update).not.toHaveBeenCalled();
  });
});

describe("bulkApproveOldSendersForUser", () => {
  it("approves only senders with no message newer than the cutoff and returns the count", async () => {
    dbMock.sender.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    const { bulkApproveOldSendersForUser } = await import(
      "@/lib/mail/mutations"
    );

    const approved = await bulkApproveOldSendersForUser(USER, 90);

    expect(approved).toBe(2);
    // The query must filter PENDING senders whose newest message predates cutoff.
    const findArg = dbMock.sender.findMany.mock.calls[0][0];
    expect(findArg.where.userId).toBe(USER);
    expect(findArg.where.status).toBe("PENDING");
    expect(findArg.where.messages.some).toEqual({});
    expect(findArg.where.messages.none.receivedAt.gte).toBeInstanceOf(Date);

    expect(dbMock.sender.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2"] } },
      data: { status: "APPROVED", category: "IMBOX", decidedAt: expect.any(Date) },
    });
  });

  it("returns 0 and writes nothing when no senders are old enough", async () => {
    dbMock.sender.findMany.mockResolvedValue([]);
    const { bulkApproveOldSendersForUser } = await import(
      "@/lib/mail/mutations"
    );

    const approved = await bulkApproveOldSendersForUser(USER, 90);

    expect(approved).toBe(0);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.sender.updateMany).not.toHaveBeenCalled();
  });
});
