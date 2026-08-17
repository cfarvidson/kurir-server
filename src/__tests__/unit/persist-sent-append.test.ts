import { describe, it, expect, vi, beforeEach } from "vitest";

const append = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { folder: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/mail/imap-client", () => ({
  withImapConnection: vi.fn(),
}));

vi.mock("nodemailer/lib/mail-composer", () => {
  return {
    default: class MailComposer {
      compile() {
        return {
          build: async () => Buffer.from("rfc822"),
        };
      }
    },
  };
});

describe("appendToImapSent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    append.mockResolvedValue(undefined);
  });

  it("returns false when there is no Sent folder", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.folder.findFirst).mockResolvedValue(null);

    const { appendToImapSent } = await import("@/lib/mail/persist-sent");
    const ok = await appendToImapSent({
      emailConnectionId: "conn-1",
      messageId: null,
      inReplyTo: null,
      references: [],
      subject: "Hi",
      fromAddress: "a@b.com",
      toAddresses: ["a@b.com"],
      text: "body",
    });
    expect(ok).toBe(false);
  });

  it("returns false when IMAP connect/append is swallowed", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      path: "Sent",
    } as never);

    const { withImapConnection } = await import("@/lib/mail/imap-client");
    vi.mocked(withImapConnection).mockResolvedValue(null);

    const { appendToImapSent } = await import("@/lib/mail/persist-sent");
    const ok = await appendToImapSent({
      emailConnectionId: "conn-1",
      messageId: null,
      inReplyTo: null,
      references: [],
      subject: "Hi",
      fromAddress: "a@b.com",
      toAddresses: ["a@b.com"],
      text: "body",
    });
    expect(ok).toBe(false);
  });

  it("returns true after a successful IMAP APPEND", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.folder.findFirst).mockResolvedValue({
      path: "Sent",
    } as never);

    const { withImapConnection } = await import("@/lib/mail/imap-client");
    vi.mocked(withImapConnection).mockImplementation(async (_id, fn) => {
      return fn({ append } as never);
    });

    const { appendToImapSent } = await import("@/lib/mail/persist-sent");
    const ok = await appendToImapSent({
      emailConnectionId: "conn-1",
      messageId: "<id@kurir.local>",
      inReplyTo: null,
      references: [],
      subject: "Hi",
      fromAddress: "a@b.com",
      toAddresses: ["a@b.com"],
      text: "body",
    });
    expect(ok).toBe(true);
    expect(append).toHaveBeenCalledWith("Sent", expect.any(Buffer), ["\\Seen"]);
  });
});
