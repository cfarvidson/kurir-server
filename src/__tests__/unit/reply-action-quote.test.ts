/**
 * The web reply action appends the quoted original (#177).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { message: { findFirst: vi.fn(), update: vi.fn() } },
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

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitSend: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  };
});

const mockSendMail = vi
  .fn()
  .mockResolvedValue({ messageId: "<reply@example.com>" });
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
  },
}));

const QUOTE_TEXT =
  "\n\nOn 8 Sep 2026, Isabelle Kornby <isabelle@example.com> wrote:\n\n" +
  "> Hej Carl-Fredrik,\n> Bifogat finner du påminnelsefakturan.";

describe("replyToMessage quotes the original", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends the quote to the wire and to the stored Sent row", async () => {
    const { auth, getConnectionCredentials } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue({
      messageId: "<orig@outlook.com>",
      threadId: "thread-1",
      splitFromThreadId: null,
      references: [],
      subject: "Sv: Hej, fondlivsfakturor",
      fromAddress: "isabelle@example.com",
      fromName: "Isabelle Kornby",
      sentAt: new Date("2026-09-08T08:35:29Z"),
      receivedAt: new Date("2026-09-08T08:35:45Z"),
      textBody: "Hej Carl-Fredrik,\nBifogat finner du påminnelsefakturan.",
      htmlBody: null,
      replyTo: null,
      emailConnectionId: "conn-1",
    } as any);
    vi.mocked(getConnectionCredentials).mockResolvedValue({
      email: "me@example.com",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
      password: "pass",
      accessToken: null,
      oauthProvider: null,
      imap: { host: "imap.example.com", port: 993 },
      smtp: { host: "smtp.example.com", port: 587 },
    });
    vi.mocked(db.message.update).mockResolvedValue({} as any);

    const { replyToMessage } = await import("@/actions/reply");
    await replyToMessage("msg-1", "Ok, jag betalade fakturan igår.");

    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.text).toBe("Ok, jag betalade fakturan igår." + QUOTE_TEXT);
    expect(sent.inReplyTo).toBe("<orig@outlook.com>");
    const quoteAt = sent.html.indexOf('<blockquote type="cite"');
    expect(quoteAt).toBeGreaterThan(sent.html.indexOf("Ok, jag betalade"));
    expect(quoteAt).toBeLessThan(sent.html.lastIndexOf("</body>"));

    const { createLocalSentMessage } = await import("@/lib/mail/persist-sent");
    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Ok, jag betalade fakturan igår." + QUOTE_TEXT,
        html: expect.stringContaining('<blockquote type="cite"'),
      }),
    );
  });
});
