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

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/mail/archive-imap", () => ({
  moveToArchiveViaImap: vi.fn(),
  moveToInboxViaImap: vi.fn(),
}));
vi.mock("@/lib/mail/contacts", () => ({
  findOrCreateContactForEmail: vi.fn(),
}));
vi.mock("@/lib/mail/flag-push", () => ({ suppressEcho: vi.fn() }));

describe("setThreadReadState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nudges native clients with the thread's message ids when marking read", async () => {
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

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", true);
    expect(nudgeIosClients).toHaveBeenCalledWith("user-1", ["m1", "m2"]);
  });

  it("does not nudge when marking unread", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: null,
    } as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);

    const { setThreadReadState } = await import("@/lib/mail/mutations");
    await setThreadReadState("user-1", "m1", false);
    expect(nudgeIosClients).not.toHaveBeenCalled();
  });
});
