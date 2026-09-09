/**
 * In-Reply-To must come from the parsed headers, not the IMAP ENVELOPE.
 *
 * iCloud returns NIL in the ENVELOPE in-reply-to slot when the header is
 * folded onto a continuation line (nodemailer folds any In-Reply-To whose
 * value pushes the line past 76 columns, i.e. most Outlook/Gmail ids). The
 * References header is already read from the parsed source, so the row ended
 * up with references but no inReplyTo - and since #140 Sent reconciliation
 * overwrote the correct send-time value with that null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailConnection: { findUnique: vi.fn() },
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
    sender: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    attachment: { createMany: vi.fn(), updateMany: vi.fn() },
    domainRule: { findMany: vi.fn().mockResolvedValue([]) },
    subjectRule: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("imapflow", () => ({ ImapFlow: vi.fn() }));
vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));
vi.mock("@/lib/mail/flag-push", () => ({ suppressEcho: vi.fn() }));
vi.mock("@/lib/mail/imap-client", () => ({
  findArchiveMailbox: vi.fn(),
  withImapConnection: vi.fn(),
}));

const ROOT = "<3560d519-90bf-9783-d1a3-620405564207@arvidson.io>";
const PARENT =
  "<GVTP280MB2116DB13EE0FD0A6BDB5DEC6D4B12@GVTP280MB2116.SWEP280.PROD.OUTLOOK.COM>";

/** iCloud FETCH result: ENVELOPE in-reply-to is NIL, headers carry it. */
function foldedMsg(uid: number, messageId: string) {
  return {
    uid,
    envelope: {
      messageId,
      from: [{ address: "me@example.com", name: "Me" }],
      to: [{ address: "you@example.com" }],
      subject: "Re: Test",
      date: new Date(),
      inReplyTo: undefined,
    },
    flags: new Set<string>(),
    internalDate: new Date(),
    source: Buffer.from("raw email"),
  } as any;
}

async function setup() {
  const { db } = await import("@/lib/db");
  const { simpleParser } = await import("mailparser");
  vi.mocked(simpleParser).mockResolvedValue({
    text: "Hello",
    html: null,
    attachments: [],
    inReplyTo: PARENT,
    references: [ROOT, PARENT],
  } as any);
  vi.mocked(db.sender.upsert).mockResolvedValue({
    id: "sender-1",
    status: "APPROVED",
    category: "IMBOX",
  } as any);
  vi.mocked(db.sender.update).mockResolvedValue({} as any);
  vi.mocked(db.message.findMany).mockResolvedValue([]);
  vi.mocked(db.message.findFirst).mockResolvedValue(null);
  vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as any);
  vi.mocked(db.message.update).mockResolvedValue({ id: "msg-1" } as any);
  vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as any);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ingest In-Reply-To when the ENVELOPE slot is NIL", () => {
  it("keeps the header value when reconciling the Sent placeholder", async () => {
    const db = await setup();
    (vi.mocked(db.message.findFirst).mockImplementation as any)(
      async (args: any) =>
        typeof args?.where?.messageId === "string"
          ? ({ id: "placeholder-1", uid: -5 } as any)
          : null,
    );

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      foldedMsg(1615, "<sent@arvidson.io>"),
      "user-1",
      "conn-1",
      "sent-folder",
      { isInbox: false },
    );

    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "placeholder-1" },
        data: expect.objectContaining({
          inReplyTo: PARENT,
          references: [ROOT, PARENT],
        }),
      }),
    );
  });

  it("stores the header value on a fresh inbox ingest", async () => {
    const db = await setup();

    const { processMessage } = await import("@/lib/mail/sync-service");
    await processMessage(
      foldedMsg(26105, "<incoming@outlook.com>"),
      "user-1",
      "conn-1",
      "inbox-folder",
      { isInbox: true },
    );

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inReplyTo: PARENT,
          references: [ROOT, PARENT],
        }),
      }),
    );
  });
});
