import { describe, it, expect, vi, beforeEach } from "vitest";

// ensureOutboundMessageId / sendScheduledEmail must generate a stable RFC 5322
// Message-ID BEFORE the first SMTP attempt and reuse it verbatim on every
// retry, so receiving MTAs collapse duplicate deliveries caused by crashes
// or dropped connections after SMTP acceptance but before the response is
// processed. See plans/006 for the full rationale.

const sendMailMock = vi.fn().mockResolvedValue({ messageId: "<echoed>" });

vi.mock("@/lib/db", () => ({
  db: {
    scheduledMessage: { update: vi.fn() },
  },
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => v),
}));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn(),
  appendToImapSent: vi.fn(),
}));

vi.mock("@/lib/mail/markdown-to-email", () => ({
  convertMarkdownToEmailHtml: vi.fn((md: string) => ({
    emailHtml: `<p>${md}</p>`,
    inlineImageIds: [],
  })),
}));

vi.mock("@/lib/mail/attachment-helpers", () => ({
  loadAttachmentsForSend: vi.fn().mockResolvedValue({
    nodemailerAttachments: [],
    sentAttachments: [],
    ids: [],
  }),
}));

vi.mock("@/lib/mail/sse-subscribers", () => ({
  emitToUser: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

function makeMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-1",
    userId: "user-1",
    emailConnectionId: "conn-1",
    to: "recipient@example.com",
    cc: null as string | null,
    bcc: null as string | null,
    subject: "Hello",
    textBody: "hi there",
    htmlBody: null,
    inReplyToMessageId: null,
    references: null,
    attachmentIds: [],
    outboundMessageId: null as string | null,
    ...overrides,
  };
}

const connection = { id: "conn-1", email: "a@example.com" } as never;

const credentials = {
  email: "a@example.com",
  sendAsEmail: null,
  password: "secret",
  accessToken: null,
  smtp: { host: "smtp.example.com", port: 587 },
} as never;

describe("ensureOutboundMessageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates and persists a Message-ID for a message without one", async () => {
    const { ensureOutboundMessageId } = await import(
      "@/lib/mail/scheduled-send"
    );
    const { db } = await import("@/lib/db");
    const msg = makeMsg();

    const id = await ensureOutboundMessageId(msg as never, "a@example.com");

    expect(id).toMatch(
      /^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.com>$/,
    );
    expect(db.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "sched-1" },
      data: { outboundMessageId: id },
    });
  });

  it("returns the existing Message-ID unchanged and does not persist again (retry stability)", async () => {
    const { ensureOutboundMessageId } = await import(
      "@/lib/mail/scheduled-send"
    );
    const { db } = await import("@/lib/db");
    const msg = makeMsg({ outboundMessageId: "<fixed-id@example.com>" });

    const id = await ensureOutboundMessageId(msg as never, "a@example.com");

    expect(id).toBe("<fixed-id@example.com>");
    expect(db.scheduledMessage.update).not.toHaveBeenCalled();
  });
});

describe("sendScheduledEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the ensured outbound Message-ID to transporter.sendMail", async () => {
    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    const msg = makeMsg();

    await sendScheduledEmail(msg as never, connection, credentials);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMailMock.mock.calls[0][0];
    expect(callArgs.messageId).toBe(msg.outboundMessageId);
    expect(callArgs.messageId).toMatch(/^<.+@example\.com>$/);
  });

  it("reuses an already-persisted Message-ID across retries instead of generating a new one", async () => {
    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    const { db } = await import("@/lib/db");
    const msg = makeMsg({ outboundMessageId: "<stable-id@example.com>" });

    await sendScheduledEmail(msg as never, connection, credentials);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMailMock.mock.calls[0][0];
    expect(callArgs.messageId).toBe("<stable-id@example.com>");
    expect(db.scheduledMessage.update).not.toHaveBeenCalled();
  });

  it("passes cc/bcc from the row to transporter.sendMail (normalized join)", async () => {
    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    const msg = makeMsg({
      cc: "cc1@example.com, cc2@example.com",
      bcc: "hidden@example.com",
    });

    await sendScheduledEmail(msg as never, connection, credentials);

    const callArgs = sendMailMock.mock.calls[0][0];
    expect(callArgs.cc).toBe("cc1@example.com, cc2@example.com");
    expect(callArgs.bcc).toBe("hidden@example.com");
  });

  it("omits the cc/bcc keys entirely when the row has none (regression)", async () => {
    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    const msg = makeMsg();

    await sendScheduledEmail(msg as never, connection, credentials);

    const callArgs = sendMailMock.mock.calls[0][0];
    expect("cc" in callArgs).toBe(false);
    expect("bcc" in callArgs).toBe(false);
  });

  it("omits the to key for a Cc-only schedule (to stored as empty string)", async () => {
    const { sendScheduledEmail } = await import("@/lib/mail/scheduled-send");
    const msg = makeMsg({ to: "", cc: "cc-only@example.com" });

    await sendScheduledEmail(msg as never, connection, credentials);

    const callArgs = sendMailMock.mock.calls[0][0];
    expect("to" in callArgs).toBe(false);
    expect(callArgs.cc).toBe("cc-only@example.com");
  });
});
