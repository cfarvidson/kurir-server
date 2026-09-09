/**
 * A scheduled reply stores the quoted original at schedule time (#177), so
 * every later send path (cron, send-now) carries it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
    scheduledMessage: { create: vi.fn() },
    attachment: { count: vi.fn() },
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc(${s})`),
  decrypt: vi.fn((s: string) => s),
}));

vi.mock("@/lib/mail/scheduled-send", () => ({
  sendScheduledEmail: vi.fn(),
}));

const QUOTE_TEXT =
  "\n\nOn 8 Sep 2026, Isabelle Kornby <isabelle@example.com> wrote:\n\n" +
  "> Hej Carl-Fredrik,\n> Bifogat finner du påminnelsefakturan.";

async function setup() {
  const { db } = await import("@/lib/db");
  vi.mocked(db.emailConnection.findFirst).mockResolvedValue({
    id: "conn-1",
  } as any);
  vi.mocked(db.message.findFirst).mockResolvedValue({
    fromName: "Isabelle Kornby",
    fromAddress: "isabelle@example.com",
    sentAt: new Date("2026-09-08T08:35:29Z"),
    receivedAt: new Date("2026-09-08T08:35:45Z"),
    textBody: "Hej Carl-Fredrik,\nBifogat finner du påminnelsefakturan.",
    htmlBody: null,
  } as any);
  vi.mocked(db.scheduledMessage.create).mockResolvedValue({
    id: "sched-1",
  } as any);
  return db;
}

describe("insertScheduledMessageForUser quotes the original", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the quoted text, leaving html for send-time markdown conversion", async () => {
    const db = await setup();
    const { insertScheduledMessageForUser } =
      await import("@/lib/mail/scheduled-messages");
    await insertScheduledMessageForUser("user-1", {
      emailConnectionId: "conn-1",
      to: "isabelle@example.com",
      subject: "Re: Sv: Hej, fondlivsfakturor",
      textBody: "Ok, jag betalade fakturan igår.",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      inReplyToMessageId: "<orig@outlook.com>",
      references: "<orig@outlook.com>",
    } as any);

    expect(db.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", messageId: "<orig@outlook.com>" },
      }),
    );
    expect(db.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          textBody: `enc(Ok, jag betalade fakturan igår.${QUOTE_TEXT})`,
          htmlBody: null,
        }),
      }),
    );
  });

  it("inserts the html quote before </body> when html is supplied", async () => {
    const db = await setup();
    const { insertScheduledMessageForUser } =
      await import("@/lib/mail/scheduled-messages");
    await insertScheduledMessageForUser("user-1", {
      emailConnectionId: "conn-1",
      to: "isabelle@example.com",
      subject: "Re: X",
      textBody: "Ok",
      htmlBody: "<html><body>\n<p>Ok</p>\n</body></html>",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      inReplyToMessageId: "<orig@outlook.com>",
    } as any);

    const data = vi.mocked(db.scheduledMessage.create).mock.calls[0][0].data;
    expect(data.htmlBody).toMatch(
      /^enc\(<html><body>\n<p>Ok<\/p>\n<div>On 8 Sep 2026, Isabelle Kornby &lt;isabelle@example.com&gt; wrote:<\/div>\n<blockquote[\s\S]*<\/blockquote>\n<\/body><\/html>\)$/,
    );
  });

  it("does not look anything up for a new mail", async () => {
    const db = await setup();
    const { insertScheduledMessageForUser } =
      await import("@/lib/mail/scheduled-messages");
    await insertScheduledMessageForUser("user-1", {
      emailConnectionId: "conn-1",
      to: "x@example.com",
      subject: "X",
      textBody: "Hi",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    } as any);
    expect(db.message.findFirst).not.toHaveBeenCalled();
    expect(db.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ textBody: "enc(Hi)" }) }),
    );
  });
});
