import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sender: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
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

vi.mock("@/lib/mail/archive-imap", () => ({
  moveToArchiveViaImap: vi.fn(),
}));

vi.mock("@/lib/mail/contacts", () => ({
  findOrCreateContactForEmail: vi.fn(),
}));

vi.mock("@/lib/mail/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/mutations")>();
  return {
    ...actual,
    rejectSenderForUser: vi.fn(actual.rejectSenderForUser),
  };
});

vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
  isOwnAddress: vi.fn().mockReturnValue(false),
}));

describe("approveSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

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

    const { findOrCreateContactForEmail } = await import("@/lib/mail/contacts");
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
    vi.mocked(auth).mockResolvedValue(null as never);

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

describe("rejectSenders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { rejectSenders } = await import("@/actions/senders");
    await expect(rejectSenders(["s1"])).rejects.toThrow("Unauthorized");
  });

  it("calls rejectSenderForUser once per unique id", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { getOwnAddresses, isOwnAddress } = await import(
      "@/lib/mail/user-emails"
    );
    vi.mocked(getOwnAddresses).mockResolvedValue({ emails: [], domains: [] });
    vi.mocked(isOwnAddress).mockReturnValue(false);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "s1", email: "ada@x.y", displayName: "Ada", _count: { messages: 2 } },
      { id: "s2", email: "al@x.y", displayName: "Al", _count: { messages: 1 } },
    ] as never);

    const { rejectSenderForUser } = await import("@/lib/mail/mutations");
    vi.mocked(rejectSenderForUser).mockResolvedValue(undefined as never);

    const { rejectSenders } = await import("@/actions/senders");
    await expect(
      rejectSenders(["s1", "s1", "s2"], { confirmed: true }),
    ).resolves.toEqual({ rejectedIds: ["s1", "s2"] });

    expect(rejectSenderForUser).toHaveBeenCalledTimes(2);
    expect(rejectSenderForUser).toHaveBeenCalledWith("user-1", "s1");
    expect(rejectSenderForUser).toHaveBeenCalledWith("user-1", "s2");
  });

  it("returns needsConfirm when a single sender has 10+ messages", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { getOwnAddresses, isOwnAddress } = await import(
      "@/lib/mail/user-emails"
    );
    vi.mocked(getOwnAddresses).mockResolvedValue({ emails: [], domains: [] });
    vi.mocked(isOwnAddress).mockReturnValue(false);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      {
        id: "s1",
        email: "ada@x.y",
        displayName: "Ada",
        _count: { messages: 12 },
      },
    ] as never);

    const { rejectSenderForUser } = await import("@/lib/mail/mutations");
    vi.mocked(rejectSenderForUser).mockResolvedValue(undefined as never);

    const { rejectSenders } = await import("@/actions/senders");
    await expect(rejectSenders(["s1"])).resolves.toEqual({
      needsConfirm: true,
      count: 12,
    });
    expect(rejectSenderForUser).not.toHaveBeenCalled();
  });

  it("rejects a single 10+ sender when confirmed", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { getOwnAddresses, isOwnAddress } = await import(
      "@/lib/mail/user-emails"
    );
    vi.mocked(getOwnAddresses).mockResolvedValue({ emails: [], domains: [] });
    vi.mocked(isOwnAddress).mockReturnValue(false);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      {
        id: "s1",
        email: "ada@x.y",
        displayName: "Ada",
        _count: { messages: 12 },
      },
    ] as never);

    const { rejectSenderForUser } = await import("@/lib/mail/mutations");
    vi.mocked(rejectSenderForUser).mockResolvedValue(undefined as never);

    const { rejectSenders } = await import("@/actions/senders");
    await expect(rejectSenders(["s1"], { confirmed: true })).resolves.toEqual({
      rejectedIds: ["s1"],
    });

    expect(rejectSenderForUser).toHaveBeenCalledTimes(1);
    expect(rejectSenderForUser).toHaveBeenCalledWith("user-1", "s1");
  });

  it("returns no rejected ids when every sender is own", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { getOwnAddresses, isOwnAddress } = await import(
      "@/lib/mail/user-emails"
    );
    vi.mocked(getOwnAddresses).mockResolvedValue({
      emails: ["me@x.y"],
      domains: [],
    });
    vi.mocked(isOwnAddress).mockReturnValue(true);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      {
        id: "s1",
        email: "me@x.y",
        displayName: "Me",
        _count: { messages: 2 },
      },
    ] as never);

    const { rejectSenderForUser } = await import("@/lib/mail/mutations");
    vi.mocked(rejectSenderForUser).mockResolvedValue(undefined as never);

    const { rejectSenders } = await import("@/actions/senders");
    await expect(rejectSenders(["s1"], { confirmed: true })).resolves.toEqual({
      rejectedIds: [],
    });
    expect(rejectSenderForUser).not.toHaveBeenCalled();
  });
});
