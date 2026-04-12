import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sender: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    folder: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void) => fn()),
}));

vi.mock("@/actions/archive", () => ({
  moveToArchiveViaImap: vi.fn(),
}));

vi.mock("@/actions/contacts", () => ({
  findOrCreateContactForEmail: vi.fn(),
}));

describe("approveSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { approveSender } = await import("@/actions/senders");
    await expect(approveSender("sender-1", "IMBOX")).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("throws when sender not owned by user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { approveSender } = await import("@/actions/senders");
    await expect(approveSender("sender-1", "IMBOX")).rejects.toThrow(
      "Sender not found",
    );
  });

  it("approves sender and triggers contact creation", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findUnique)
      .mockResolvedValueOnce({ userId: "user-1" } as any)
      .mockResolvedValueOnce({
        email: "sender@example.com",
        displayName: "Sender",
      } as any);

    vi.mocked(db.$transaction).mockResolvedValue(undefined);

    const { approveSender } = await import("@/actions/senders");
    await approveSender("sender-1", "FEED");

    expect(db.$transaction).toHaveBeenCalled();

    const { findOrCreateContactForEmail } = await import("@/actions/contacts");
    expect(findOrCreateContactForEmail).toHaveBeenCalledWith(
      "user-1",
      "sender@example.com",
      "Sender",
    );
  });
});

describe("rejectSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { rejectSender } = await import("@/actions/senders");
    await expect(rejectSender("sender-1")).rejects.toThrow("Unauthorized");
  });

  it("rejects sender and archives messages", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findUnique).mockResolvedValue({
      userId: "user-1",
      emailConnectionId: "conn-1",
    } as any);

    vi.mocked(db.message.findMany).mockResolvedValue([]);
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);
    vi.mocked(db.$transaction).mockResolvedValue(undefined);

    const { rejectSender } = await import("@/actions/senders");
    await rejectSender("sender-1");

    expect(db.$transaction).toHaveBeenCalled();
  });
});
