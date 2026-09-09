/**
 * POST /api/mail/send appends the quoted original to a reply (#177).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getConnectionCredentials: vi.fn(),
  getDefaultConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn().mockResolvedValue({ id: "sent-1" }),
  appendToImapSent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mail/thread-assign", () => ({
  assignThread: vi
    .fn()
    .mockResolvedValue({ threadId: null, splitFromThreadId: null }),
}));

vi.mock("@/lib/mail/mutations", () => ({
  applyFollowUpAfterSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mail/contacts", () => ({
  findOrCreateContactForEmail: vi.fn().mockResolvedValue({ id: "c1" }),
}));

vi.mock("@/lib/mail/drafts", () => ({
  deleteDraftForUser: vi.fn().mockResolvedValue(undefined),
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
  .mockResolvedValue({ messageId: "<sent@example.com>" });
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
  },
}));

import type { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ORIGINAL = {
  fromName: "Isabelle Kornby",
  fromAddress: "isabelle@example.com",
  sentAt: new Date("2026-09-08T08:35:29Z"),
  receivedAt: new Date("2026-09-08T08:35:45Z"),
  textBody: "Hej Carl-Fredrik,\nBifogat finner du påminnelsefakturan.",
  htmlBody: null,
};

const QUOTE_TEXT =
  "\n\nOn 8 Sep 2026, Isabelle Kornby <isabelle@example.com> wrote:\n\n" +
  "> Hej Carl-Fredrik,\n> Bifogat finner du påminnelsefakturan.";

async function signIn() {
  const { auth, getDefaultConnectionCredentials } = await import("@/lib/auth");
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
  vi.mocked(getDefaultConnectionCredentials).mockResolvedValue({
    connectionId: "conn-default",
    email: "me@example.com",
    sendAsEmail: null,
    aliases: [],
    treatDomainAsOwn: false,
    password: "pass",
    accessToken: null,
    oauthProvider: null,
    imap: { host: "imap.example.com", port: 993 },
    smtp: { host: "smtp.example.com", port: 587 },
  } as any);
}

describe("POST /api/mail/send quotes the original on replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends the attribution and quote to text and html, and stores the same", async () => {
    await signIn();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(ORIGINAL as any);

    const { POST } = await import("@/app/api/mail/send/route");
    const response = await POST(
      makeRequest({
        to: "isabelle@example.com",
        subject: "Re: Sv: Hej, fondlivsfakturor",
        text: "Ok, jag betalade fakturan igår.",
        inReplyTo: "<orig@outlook.com>",
        references: ["<root@arvidson.io>", "<orig@outlook.com>"],
      }),
    );
    expect(response.status).toBe(200);

    expect(db.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", messageId: "<orig@outlook.com>" },
      }),
    );

    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.text).toBe("Ok, jag betalade fakturan igår." + QUOTE_TEXT);
    expect(sent.html).toContain("<p>Ok, jag betalade fakturan igår.</p>");
    const quoteAt = sent.html.indexOf('<blockquote type="cite"');
    expect(quoteAt).toBeGreaterThan(sent.html.indexOf("Ok, jag betalade"));
    expect(quoteAt).toBeLessThan(sent.html.lastIndexOf("</body>"));
    expect(sent.html).toContain("Bifogat finner du påminnelsefakturan.");

    const { createLocalSentMessage, appendToImapSent } =
      await import("@/lib/mail/persist-sent");
    expect(createLocalSentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Ok, jag betalade fakturan igår." + QUOTE_TEXT,
        html: expect.stringContaining('<blockquote type="cite"'),
      }),
    );
    expect(appendToImapSent).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Ok, jag betalade fakturan igår." + QUOTE_TEXT,
        html: expect.stringContaining('<blockquote type="cite"'),
      }),
    );
  });

  it("sends a reply unchanged when the original is not in the database", async () => {
    await signIn();
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findFirst).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mail/send/route");
    await POST(
      makeRequest({
        to: "x@example.com",
        subject: "Re: X",
        text: "Ok",
        inReplyTo: "<unknown@example.com>",
      }),
    );

    expect(mockSendMail.mock.calls[0][0].text).toBe("Ok");
    expect(mockSendMail.mock.calls[0][0].html).not.toContain("<blockquote");
  });

  it("does not look anything up for a new mail", async () => {
    await signIn();
    const { db } = await import("@/lib/db");

    const { POST } = await import("@/app/api/mail/send/route");
    await POST(makeRequest({ to: "x@example.com", subject: "X", text: "Hi" }));

    expect(db.message.findFirst).not.toHaveBeenCalled();
    expect(mockSendMail.mock.calls[0][0].text).toBe("Hi");
  });
});
