/**
 * Unit tests for the replyToMessage server action.
 * Verifies that reply uses the emailConnectionId from the original message
 * rather than looking up credentials by userId.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn().mockResolvedValue({ id: "sent-1" }),
  appendToImapSent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const mockSendMail = vi
  .fn()
  .mockResolvedValue({ messageId: "<reply@example.com>" });
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: mockSendMail,
    }),
  },
}));

describe("replyToMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws Unauthorized when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { replyToMessage } = await import("@/actions/reply");
    await expect(replyToMessage("msg-1", "Hello")).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("throws when message not found", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { replyToMessage } = await import("@/actions/reply");
    await expect(replyToMessage("non-existent", "Hello")).rejects.toThrow(
      "Message not found",
    );
  });

  it("uses emailConnectionId from the message to get credentials", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      messageId: "<original@example.com>",
      threadId: "thread-1",
      references: [],
      subject: "Original",
      fromAddress: "sender@example.com",
      replyTo: null,
      emailConnectionId: "conn-work", // the key field
    } as any);

    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@work.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.work.com", port: 993 },
      smtp: { host: "smtp.work.com", port: 587 },
    });

    vi.mocked(db.message.update).mockResolvedValue({} as any);

    const { replyToMessage } = await import("@/actions/reply");
    await replyToMessage("msg-1", "My reply");

    // Should call getConnectionCredentials with the connection from the message and user id
    expect(getConnectionCredentials).toHaveBeenCalledWith(
      "conn-work",
      "user-1",
    );
  });

  it("throws when credentials not found", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      messageId: "<original@example.com>",
      threadId: null,
      references: [],
      subject: "Test",
      fromAddress: "from@example.com",
      replyTo: null,
      emailConnectionId: "conn-deleted",
    } as any);

    vi.mocked(getConnectionCredentials).mockResolvedValue(null);

    const { replyToMessage } = await import("@/actions/reply");
    await expect(replyToMessage("msg-1", "reply")).rejects.toThrow(
      "Email credentials not found",
    );
  });

  it("sends from the correct email address (from the connection)", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      messageId: "<original@example.com>",
      threadId: "thread-1",
      references: [],
      subject: "Hello",
      fromAddress: "sender@example.com",
      replyTo: null,
      emailConnectionId: "conn-gmail",
    } as any);

    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "myaccount@gmail.com",
      sendAsEmail: null,
      aliases: [],
      password: "app-password",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });

    vi.mocked(db.message.update).mockResolvedValue({} as any);

    const { replyToMessage } = await import("@/actions/reply");
    await replyToMessage("msg-1", "My reply body");

    // sendMail should use the connection's email as the from address
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "myaccount@gmail.com",
      }),
    );
  });

  it("passes emailConnectionId to createLocalSentMessage", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      messageId: "<original@example.com>",
      threadId: "thread-1",
      references: [],
      subject: "Subject",
      fromAddress: "from@example.com",
      replyTo: null,
      emailConnectionId: "conn-icloud",
    } as any);

    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@icloud.com",
      sendAsEmail: null,
      aliases: [],
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.mail.me.com", port: 993 },
      smtp: { host: "smtp.mail.me.com", port: 587 },
    });

    vi.mocked(db.message.update).mockResolvedValue({} as any);

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    const { replyToMessage } = await import("@/actions/reply");
    await replyToMessage("msg-1", "reply text");

    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        emailConnectionId: "conn-icloud",
      }),
    );
  });
});
