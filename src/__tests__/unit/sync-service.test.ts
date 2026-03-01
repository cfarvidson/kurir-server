/**
 * Unit tests for the sync service (syncEmailConnection).
 * Verifies that sync is scoped to an EmailConnection, not a User.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: {
      findUnique: vi.fn(),
    },
    folder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sender: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attachment: {
      createMany: vi.fn(),
    },
  },
}));

// Mock ImapFlow to avoid real network calls
vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue({
      messages: 0,
      uidNext: 1,
      uidValidity: 1n,
      highestModseq: 1n,
    }),
    getMailboxLock: vi.fn().mockResolvedValue({
      release: vi.fn(),
    }),
  })),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

describe("syncEmailConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when connection credentials not found", async () => {
    const { getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentials).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("non-existent-conn");

    expect(result.success).toBe(false);
    expect(result.error).toContain("credentials not found");
  });

  it("returns error when email connection record not found", async () => {
    const { getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@example.com",
      password: "pass",
      imap: { host: "imap.example.com", port: 993 },
      smtp: { host: "smtp.example.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    const result = await syncEmailConnection("conn-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Email connection not found");
  });

  it("calls getConnectionCredentials with the connectionId (not userId)", async () => {
    const { getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentials).mockResolvedValue(null);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    await syncEmailConnection("conn-abc-123");

    expect(getConnectionCredentials).toHaveBeenCalledWith("conn-abc-123");
    // Importantly: NOT called with userId
    expect(getConnectionCredentials).not.toHaveBeenCalledWith(
      expect.not.stringMatching("conn-abc-123")
    );
  });

  it("looks up emailConnection to get userId", async () => {
    const { getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@gmail.com",
      password: "pass",
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    const { db } = await import("@/lib/db");
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "user-99",
    } as any);
    // ImapFlow connect will fail, caught in try/catch
    const { ImapFlow } = await import("imapflow");
    vi.mocked(ImapFlow).mockImplementation(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error("connect failed")),
        logout: vi.fn().mockResolvedValue(undefined),
      };
    } as any);

    const { syncEmailConnection } = await import("@/lib/mail/sync-service");
    await syncEmailConnection("conn-1");

    expect(db.emailConnection.findUnique).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      select: { userId: true },
    });
  });
});

describe("processMessage scoping", () => {
  it("stores message with emailConnectionId field", async () => {
    const { db } = await import("@/lib/db");

    // Minimal mocks for processMessage
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "sender-1",
      status: "PENDING",
      category: "IMBOX",
    } as any);
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);

    const { simpleParser } = await import("mailparser");
    vi.mocked(simpleParser).mockResolvedValue({
      text: "Hello",
      html: null,
      attachments: [],
      references: [],
    } as any);

    const { processMessage } = await import("@/lib/mail/sync-service");

    const fakeMsg = {
      uid: 1,
      envelope: {
        messageId: "<test@example.com>",
        from: [{ address: "sender@example.com", name: "Sender" }],
        to: [{ address: "me@example.com" }],
        subject: "Test",
        date: new Date(),
        inReplyTo: null,
      },
      flags: new Set<string>(),
      internalDate: new Date(),
      source: Buffer.from("raw email"),
    };

    await processMessage(
      fakeMsg as any,
      "user-1",
      "conn-42", // emailConnectionId
      "folder-1",
      { isInbox: true, userEmail: "me@example.com" }
    );

    // Verify message was created with the emailConnectionId
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailConnectionId: "conn-42",
          userId: "user-1",
          folderId: "folder-1",
        }),
      })
    );
  });
});
