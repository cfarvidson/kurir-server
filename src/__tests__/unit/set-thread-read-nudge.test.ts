import { describe, it, expect, vi, beforeEach } from "vitest";

const nudgeIosClients = vi.fn();
vi.mock("@/lib/mail/push-sender", () => ({
  nudgeIosClients: (...args: unknown[]) => nudgeIosClients(...args),
  pushToUser: vi.fn(),
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

// Run deferred IMAP work inline so the test can observe it.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/mail/archive-imap", () => ({
  moveToArchiveViaImap: vi.fn(),
  moveToInboxViaImap: vi.fn(),
}));
vi.mock("@/lib/mail/contacts", () => ({
  findOrCreateContactForEmail: vi.fn(),
}));
const pushFlagsToImap = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mail/flag-push", () => ({
  suppressEcho: vi.fn(),
  pushFlagsToImap: (...args: unknown[]) => pushFlagsToImap(...args),
}));

describe("setThreadReadState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nudges native clients with the thread's message ids when marking read", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: "t1",
      uid: 10,
      folderId: "f1",
    } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 10, folderId: "f1" },
      { id: "m2", uid: 11, folderId: "f1" },
    ] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never);

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", true);
    expect(nudgeIosClients).toHaveBeenCalledWith("user-1", ["m1", "m2"]);
  });

  // Regression: reads from the native apps only updated the DB, so IMAP kept
  // \Unseen and the CONDSTORE catch-up after a reconnect flipped every read
  // message back to unread (omarchy 2026-09-08 14:07 UTC, 9 messages).
  it("pushes \\Seen to IMAP for the whole thread when marking read", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: "t1",
      uid: 10,
      folderId: "f1",
    } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 10, folderId: "f1" },
      { id: "m2", uid: 11, folderId: "f1" },
    ] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never);

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", true);
    expect(pushFlagsToImap).toHaveBeenCalledWith(
      "user-1",
      [
        { uid: 10, folderId: "f1" },
        { uid: 11, folderId: "f1" },
      ],
      "\\Seen",
      "add",
    );
  });

  it("removes \\Seen on IMAP when marking unread", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
      uid: 10,
      folderId: "f1",
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", false);
    expect(pushFlagsToImap).toHaveBeenCalledWith(
      "user-1",
      [{ uid: 10, folderId: "f1" }],
      "\\Seen",
      "remove",
    );
  });

  it("does not nudge when marking unread", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
      uid: 10,
      folderId: "f1",
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", false);
    expect(nudgeIosClients).not.toHaveBeenCalled();
  });
});
