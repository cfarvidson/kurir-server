import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mail/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/messages")>();
  return { ...actual, getMessages: vi.fn() };
});

vi.mock("@/lib/mail/threads", () => ({
  getThreadMessages: vi.fn(),
}));

vi.mock("@/lib/mail/search", () => ({
  searchMessages: vi.fn(),
}));

vi.mock("@/lib/mail/sidebar-counts", () => ({
  getSidebarCounts: vi.fn(),
}));

vi.mock("@/lib/mail/files", () => ({
  getFiles: vi.fn(),
}));

vi.mock("@/lib/mail/drafts", () => ({
  listDraftsForUser: vi.fn(),
  saveDraftForUser: vi.fn(),
  deleteDraftForUser: vi.fn(),
}));

vi.mock("@/lib/mail/mutations", () => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  setThreadReadState: vi.fn(),
  snoozeThread: vi.fn(),
  unsnoozeThread: vi.fn(),
  setThreadFollowUp: vi.fn(),
  dismissThreadFollowUp: vi.fn(),
  setThreadReplyLater: vi.fn(),
  approveSenderForUser: vi.fn(),
  skipSenderForUser: vi.fn(),
  unskipSenderForUser: vi.fn(),
  undoScreenActionForUser: vi.fn(),
  changeSenderCategoryForUser: vi.fn(),
  setSenderUnthreadForUser: vi.fn(),
  setSenderAllowImagesForUser: vi.fn(),
  createDomainRuleForUser: vi.fn(),
  changeDomainRuleCategoryForUser: vi.fn(),
  deleteDomainRuleForUser: vi.fn(),
  listDomainRulesForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
  bulkApproveOldSendersForUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/mail/scheduled-messages", () => ({
  updateScheduledForUser: vi.fn(),
  cancelScheduledForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  canManageConnections: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/mcp/confirmations", () => ({
  createConfirmation: vi.fn(),
  consumeConfirmation: vi.fn(),
  consumeConfirmationInTx: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitUploads: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  rateLimitSync: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 }),
  rateLimitSend: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
}));

vi.mock("@/lib/jobs/queue", () => ({
  getSyncQueue: vi.fn(() => ({ add: vi.fn() })),
}));

vi.mock("@/lib/jobs/maintenance-tasks", () => ({
  approveOwnPendingSenders: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
    sender: { findMany: vi.fn(), findFirst: vi.fn() },
    scheduledMessage: { findMany: vi.fn() },
    attachment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    emailConnection: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    passkey: { findMany: vi.fn() },
    mcpConfirmation: { create: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    contactGroup: { findMany: vi.fn() },
  },
}));

import { getMessages } from "@/lib/mail/messages";
import { getThreadMessages } from "@/lib/mail/threads";
import { searchMessages } from "@/lib/mail/search";
import { getSidebarCounts } from "@/lib/mail/sidebar-counts";
import { getFiles } from "@/lib/mail/files";
import { listDraftsForUser } from "@/lib/mail/drafts";
import { archiveThread, createDomainRuleForUser } from "@/lib/mail/mutations";
import { db } from "@/lib/db";
import { defaultAttachmentUploadStore } from "@/lib/mail/attachment-upload-session";
import { getTool, listTools } from "@/lib/mcp/tools";
import type { ToolContext } from "@/lib/mcp/types";

const ctx: ToolContext = {
  userId: "u1",
  tokenId: "t1",
  hasElicitation: false,
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const tool = getTool(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(ctx, args);
}

describe("MCP read tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the five read tools as read-only", () => {
    const names = listTools().map((t) => t.name);
    for (const name of [
      "list_mail",
      "get_thread",
      "search_mail",
      "get_counts",
      "get_attachment",
    ]) {
      expect(names).toContain(name);
      expect(getTool(name)?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("list_mail imbox calls getMessages with default limit 25", async () => {
    vi.mocked(getMessages).mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const result = await call("list_mail", { view: "imbox" });
    expect(getMessages).toHaveBeenCalledWith("u1", "imbox", 25, undefined);
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: { items: [] },
    });
  });

  it("list_mail maps paper_trail, follow_up, and reply_later views", async () => {
    vi.mocked(getMessages).mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    await call("list_mail", { view: "paper_trail" });
    expect(getMessages).toHaveBeenCalledWith(
      "u1",
      "paper-trail",
      25,
      undefined,
    );
    await call("list_mail", { view: "follow_up" });
    expect(getMessages).toHaveBeenCalledWith("u1", "follow-up", 25, undefined);
    await call("list_mail", { view: "reply_later" });
    expect(getMessages).toHaveBeenCalledWith(
      "u1",
      "reply-later",
      25,
      undefined,
    );
  });

  it("list_mail unknown view returns an error result", async () => {
    const result = await call("list_mail", { view: "trash" });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/unknown view/i),
    });
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("list_mail serializes compact rows without htmlBody", async () => {
    vi.mocked(getMessages).mockResolvedValue({
      messages: [
        {
          id: "m1",
          threadId: "th1",
          fromAddress: "ada@example.com",
          fromName: "Ada",
          subject: "Hello",
          receivedAt: new Date("2026-08-14T12:00:00.000Z"),
          snippet: "Hi",
          isRead: false,
          isFlagged: false,
          hasAttachments: false,
          snoozedUntil: null,
          followUpAt: null,
          isFollowUp: false,
          sender: null,
          threadCount: 1,
          htmlBody: "<p>nope</p>",
        } as never,
      ],
      nextCursor: "cur1",
    });
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        threadId: "th1",
        fromAddress: "ada@example.com",
        fromName: "Ada",
        toAddresses: ["bob@example.com"],
        subject: "Hello",
        receivedAt: new Date("2026-08-14T12:00:00.000Z"),
        snippet: "Hi",
        isRead: false,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        isInScreener: false,
        snoozedUntil: null,
        followUpAt: null,
        isReplyLater: false,
      },
    ] as never);
    const result = await call("list_mail", { view: "imbox" });
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    const content = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      nextCursor?: string;
    };
    expect(content.items[0]).toMatchObject({
      id: "m1",
      from: "Ada <ada@example.com>",
      to: ["bob@example.com"],
      subject: "Hello",
      snippet: "Hi",
      isRead: false,
      isInImbox: true,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      isInScreener: false,
    });
    expect(content.items[0]).not.toHaveProperty("htmlBody");
    expect(content.nextCursor).toBe("cur1");
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", id: { in: ["m1"] } },
      }),
    );
  });

  it("list_mail clamps the page size to 50", async () => {
    vi.mocked(getMessages).mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    await call("list_mail", { view: "feed", limit: 999 });
    expect(getMessages).toHaveBeenCalledWith("u1", "feed", 50, undefined);
  });

  it("list_mail sent queries folders with specialUse sent", async () => {
    vi.mocked(db.message.findMany).mockResolvedValue([]);
    const result = await call("list_mail", { view: "sent" });
    expect(result.type).toBe("ok");
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          folder: { specialUse: "sent" },
        }),
      }),
    );
  });

  it("list_mail drafts uses listDraftsForUser", async () => {
    vi.mocked(listDraftsForUser).mockResolvedValue([]);
    const result = await call("list_mail", { view: "drafts" });
    expect(listDraftsForUser).toHaveBeenCalledWith("u1");
    expect(result.type).toBe("ok");
  });

  it("list_mail files uses getFiles", async () => {
    vi.mocked(getFiles).mockResolvedValue({ files: [], nextCursor: null });
    const result = await call("list_mail", { view: "files" });
    expect(getFiles).toHaveBeenCalledWith("u1", {
      limit: 25,
      cursor: undefined,
    });
    expect(result.type).toBe("ok");
  });

  it("list_mail scheduled queries the user's scheduled messages", async () => {
    vi.mocked(db.scheduledMessage.findMany).mockResolvedValue([]);
    const result = await call("list_mail", { view: "scheduled" });
    expect(db.scheduledMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
    expect(result.type).toBe("ok");
  });

  it("list_mail scheduled honors cursor and emits a keyset nextCursor", async () => {
    const id1 = "cm1234567890abcdefghij";
    const id2 = "cm1234567890abcdefghik";
    const t1 = new Date("2026-08-14T10:00:00.000Z");
    const t2 = new Date("2026-08-14T11:00:00.000Z");
    vi.mocked(db.scheduledMessage.findMany).mockResolvedValue([
      {
        id: id1,
        to: "a@b.c",
        cc: null,
        subject: "one",
        scheduledFor: t1,
        status: "PENDING",
      },
      {
        id: id2,
        to: "c@d.e",
        cc: null,
        subject: "two",
        scheduledFor: t2,
        status: "PENDING",
      },
    ] as never);

    const first = await call("list_mail", { view: "scheduled", limit: 2 });
    expect(first.type).toBe("ok");
    if (first.type !== "ok") return;
    const nextCursor = (first.structuredContent as { nextCursor?: string })
      .nextCursor;
    expect(nextCursor).toBe(`${t2.toISOString()}_${id2}`);

    vi.mocked(db.scheduledMessage.findMany).mockResolvedValue([]);
    await call("list_mail", { view: "scheduled", cursor: nextCursor });
    expect(db.scheduledMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          OR: [
            { scheduledFor: { gt: t2 } },
            { scheduledFor: t2, id: { gt: id2 } },
          ],
        }),
      }),
    );
  });

  it("list_mail screener honors cursor and emits a keyset nextCursor", async () => {
    const id1 = "cm1234567890abcdefghij";
    const id2 = "cm1234567890abcdefghik";
    const t1 = new Date("2026-08-14T12:00:00.000Z");
    const t2 = new Date("2026-08-13T12:00:00.000Z");
    vi.mocked(db.sender.findMany).mockResolvedValue([
      {
        id: id1,
        createdAt: t1,
        email: "a@b.c",
        displayName: "A",
        messages: [],
      },
      {
        id: id2,
        createdAt: t2,
        email: "c@d.e",
        displayName: "B",
        messages: [],
      },
    ] as never);

    const first = await call("list_mail", { view: "screener", limit: 2 });
    expect(first.type).toBe("ok");
    if (first.type !== "ok") return;
    const nextCursor = (first.structuredContent as { nextCursor?: string })
      .nextCursor;
    expect(nextCursor).toBe(`${t2.toISOString()}_${id2}`);

    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    await call("list_mail", { view: "screener", cursor: nextCursor });
    expect(db.sender.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ createdAt: { lt: t2 } }, { createdAt: t2, id: { lt: id2 } }],
        }),
      }),
    );
  });

  it("list_mail rejects a malformed cursor on screener and scheduled", async () => {
    const screener = await call("list_mail", {
      view: "screener",
      cursor: "not-a-cursor",
    });
    expect(screener).toMatchObject({
      type: "error",
      message: "Invalid cursor",
    });
    expect(db.sender.findMany).not.toHaveBeenCalled();

    const scheduled = await call("list_mail", {
      view: "scheduled",
      cursor: "not-a-cursor",
    });
    expect(scheduled).toMatchObject({
      type: "error",
      message: "Invalid cursor",
    });
    expect(db.scheduledMessage.findMany).not.toHaveBeenCalled();
  });

  it("list_mail rejects a connectionId that is not the user's", async () => {
    vi.mocked(db.emailConnection.findFirst).mockResolvedValue(null);
    const result = await call("list_mail", {
      view: "imbox",
      connectionId: "c-other",
    });
    expect(result).toMatchObject({
      type: "error",
      message: "not found or not yours",
    });
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("list_mail catches thrown errors", async () => {
    vi.mocked(getMessages).mockRejectedValue(new Error("IMAP down"));
    const result = await call("list_mail", { view: "imbox" });
    expect(result).toEqual({ type: "error", message: "IMAP down" });
  });

  it("get_thread uses getThreadMessages and errors when missing", async () => {
    vi.mocked(getThreadMessages).mockResolvedValue(null);
    const missing = await call("get_thread", { messageId: "m-missing" });
    expect(getThreadMessages).toHaveBeenCalledWith("u1", "m-missing");
    expect(missing).toMatchObject({
      type: "error",
      message: "not found or not yours",
    });

    vi.mocked(getThreadMessages).mockResolvedValue({
      messages: [
        {
          id: "m1",
          threadId: "th1",
          fromAddress: "ada@example.com",
          fromName: "Ada",
          toAddresses: ["bob@example.com"],
          ccAddresses: [],
          subject: "Hello",
          receivedAt: new Date("2026-08-14T12:00:00.000Z"),
          textBody: "plain",
          htmlBody: "<p>html</p>",
          isRead: true,
          attachments: [],
        },
      ],
      markedRead: [],
    } as never);
    const found = await call("get_thread", { messageId: "m1" });
    expect(found.type).toBe("ok");
    if (found.type !== "ok") return;
    const content = found.structuredContent as {
      messages: Array<Record<string, unknown>>;
    };
    expect(content.messages[0]).toMatchObject({
      id: "m1",
      text: "plain",
    });
    expect(content.messages[0]).not.toHaveProperty("htmlBody");
  });

  it("search_mail re-fetches hits in FTS rank order", async () => {
    vi.mocked(searchMessages).mockResolvedValue([
      { id: "m2" },
      { id: "m1" },
    ] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        threadId: "th1",
        fromAddress: "a@b.c",
        fromName: null,
        toAddresses: [],
        subject: "first",
        receivedAt: new Date("2026-08-14T12:00:00.000Z"),
        snippet: "a",
        isRead: true,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        isInScreener: false,
      },
      {
        id: "m2",
        threadId: "th2",
        fromAddress: "c@d.e",
        fromName: null,
        toAddresses: [],
        subject: "second",
        receivedAt: new Date("2026-08-14T11:00:00.000Z"),
        snippet: "b",
        isRead: false,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: false,
        isInScreener: false,
      },
    ] as never);

    const result = await call("search_mail", { q: "invoice" });
    expect(searchMessages).toHaveBeenCalledWith(
      "u1",
      "invoice",
      expect.anything(),
      20,
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", id: { in: ["m2", "m1"] } },
      }),
    );
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    const items = (result.structuredContent as { items: Array<{ id: string }> })
      .items;
    expect(items.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("search_mail clamps limit to 50 and requires q", async () => {
    vi.mocked(searchMessages).mockResolvedValue([]);
    await call("search_mail", { q: "ok", limit: 999 });
    expect(searchMessages).toHaveBeenCalledWith(
      "u1",
      "ok",
      expect.anything(),
      50,
    );

    const missing = await call("search_mail", {});
    expect(missing).toMatchObject({ type: "error" });
  });

  it("get_counts uses getSidebarCounts", async () => {
    vi.mocked(getSidebarCounts).mockResolvedValue({
      screenerCount: 1,
      imboxUnreadCount: 2,
      scheduledCount: 0,
      followUpCount: 0,
      replyLaterCount: 0,
      feedUnreadCount: 0,
      paperTrailUnreadCount: 0,
      badgePreferences: {} as never,
    });
    const result = await call("get_counts", {});
    expect(getSidebarCounts).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: { screenerCount: 1, imboxUnreadCount: 2 },
    });
  });

  it("get_attachment inlines small text and images and otherwise opens in app", async () => {
    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a1",
      filename: "note.txt",
      contentType: "text/plain",
      size: 5,
      content: Buffer.from("hello"),
      userId: "u1",
      message: null,
    } as never);
    const text = await call("get_attachment", { attachmentId: "a1" });
    expect(text).toMatchObject({
      type: "ok",
      structuredContent: {
        filename: "note.txt",
        contentType: "text/plain",
        size: 5,
        text: "hello",
      },
    });

    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a2",
      filename: "pic.png",
      contentType: "image/png",
      size: 4,
      content: Buffer.from([1, 2, 3, 4]),
      userId: null,
      message: { userId: "u1" },
    } as never);
    const image = await call("get_attachment", { attachmentId: "a2" });
    expect(image).toMatchObject({
      type: "ok",
      structuredContent: {
        filename: "pic.png",
        contentType: "image/png",
        data: Buffer.from([1, 2, 3, 4]).toString("base64"),
      },
    });

    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a3",
      filename: "big.pdf",
      contentType: "application/pdf",
      size: 2_000_000,
      content: Buffer.alloc(10),
      userId: "u1",
      message: null,
    } as never);
    const pdf = await call("get_attachment", { attachmentId: "a3" });
    expect(pdf).toMatchObject({
      type: "ok",
      structuredContent: {
        openInApp: true,
        filename: "big.pdf",
        contentType: "application/pdf",
        size: 2_000_000,
      },
    });
  });

  it("get_attachment inlines a small PDF as base64 so MCP clients do not write a 0-byte file", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 small");
    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a4",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: pdfBytes.length,
      content: pdfBytes,
      userId: "u1",
      message: null,
    } as never);
    const result = await call("get_attachment", { attachmentId: "a4" });
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: pdfBytes.length,
        data: pdfBytes.toString("base64"),
      },
    });
    expect(result).not.toMatchObject({
      structuredContent: { openInApp: true },
    });
  });

  it("get_attachment does not treat empty stored bytes as file content", async () => {
    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a5",
      filename: "ghost.pdf",
      contentType: "application/pdf",
      size: 0,
      content: Buffer.alloc(0),
      userId: "u1",
      message: null,
    } as never);
    const result = await call("get_attachment", { attachmentId: "a5" });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/not available/i),
    });
  });

  it("get_attachment hides attachments that are not the user's", async () => {
    vi.mocked(db.attachment.findUnique).mockResolvedValue({
      id: "a9",
      filename: "secret.txt",
      contentType: "text/plain",
      size: 1,
      content: Buffer.from("x"),
      userId: "other",
      message: { userId: "other" },
    } as never);
    const result = await call("get_attachment", { attachmentId: "a9" });
    expect(result).toMatchObject({
      type: "error",
      message: "not found or not yours",
    });
  });
});

describe("MCP write tools — upload_attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultAttachmentUploadStore.clear();
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { size: 0 },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({
      id: "up-1",
    } as never);
  });

  it("stores plain base64 bytes and returns the new attachment id", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 plain");
    const result = await call("upload_attachment", {
      filename: "plain.pdf",
      contentType: "application/pdf",
      data: pdfBytes.toString("base64"),
    });
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: { id: "up-1" },
    });
    const stored = vi.mocked(db.attachment.create).mock.calls[0][0].data
      .content as Buffer;
    expect(Buffer.from(stored).equals(pdfBytes)).toBe(true);
    expect(vi.mocked(db.attachment.create).mock.calls[0][0].data.size).toBe(
      pdfBytes.length,
    );
  });

  it("decodes a data: URL and stores the real bytes, not an empty file", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 from data url");
    const result = await call("upload_attachment", {
      filename: "doc.pdf",
      contentType: "application/pdf",
      data: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
    });
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: { id: "up-1" },
    });
    expect(db.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filename: "doc.pdf",
          contentType: "application/pdf",
          size: pdfBytes.length,
        }),
      }),
    );
    const stored = vi.mocked(db.attachment.create).mock.calls[0][0].data
      .content as Uint8Array;
    expect(Buffer.from(stored).equals(pdfBytes)).toBe(true);
  });

  it("rejects a data: URL with no payload instead of creating a 0-byte row", async () => {
    const result = await call("upload_attachment", {
      filename: "doc.pdf",
      contentType: "application/pdf",
      data: "data:application/pdf;base64,",
    });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/empty/i),
    });
    expect(db.attachment.create).not.toHaveBeenCalled();
  });

  it("starts a chunked upload without persisting until the last chunk", async () => {
    const result = await call("upload_attachment", {
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      data: Buffer.from("%PDF-1.4 a").toString("base64"),
      done: false,
    });
    expect(result).toMatchObject({
      type: "ok",
      structuredContent: {
        complete: false,
        receivedBytes: Buffer.byteLength("%PDF-1.4 a"),
        uploadId: expect.any(String),
      },
    });
    expect(db.attachment.create).not.toHaveBeenCalled();
  });

  it("assembles chunks and stores the full file on done=true", async () => {
    const start = await call("upload_attachment", {
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      data: Buffer.from("%PDF-1.4 part-a").toString("base64"),
      done: false,
    });
    expect(start).toMatchObject({ type: "ok" });
    const uploadId = (start as { structuredContent: { uploadId: string } })
      .structuredContent.uploadId;

    const middle = await call("upload_attachment", {
      uploadId,
      data: Buffer.from("-part-b").toString("base64"),
      done: false,
    });
    expect(middle).toMatchObject({
      type: "ok",
      structuredContent: { complete: false, uploadId },
    });
    expect(db.attachment.create).not.toHaveBeenCalled();

    const done = await call("upload_attachment", {
      uploadId,
      data: Buffer.from("-end").toString("base64"),
      done: true,
    });
    expect(done).toMatchObject({
      type: "ok",
      structuredContent: { id: "up-1", complete: true },
    });

    const stored = vi.mocked(db.attachment.create).mock.calls[0][0].data
      .content as Buffer;
    expect(Buffer.from(stored).toString("utf8")).toBe(
      "%PDF-1.4 part-a-part-b-end",
    );
    expect(vi.mocked(db.attachment.create).mock.calls[0][0].data).toMatchObject({
      filename: "felix-cv.pdf",
      contentType: "application/pdf",
      size: Buffer.byteLength("%PDF-1.4 part-a-part-b-end"),
    });
  });

  it("does not let another user finish a chunked upload session", async () => {
    const start = await call("upload_attachment", {
      filename: "secret.bin",
      contentType: "application/octet-stream",
      data: Buffer.from("mine").toString("base64"),
      done: false,
    });
    const uploadId = (start as { structuredContent: { uploadId: string } })
      .structuredContent.uploadId;

    const other = getTool("upload_attachment");
    if (!other) throw new Error("tool not registered");
    const result = await other.handler(
      { userId: "u2", tokenId: "t2", hasElicitation: false },
      { uploadId, data: Buffer.from("x").toString("base64"), done: true },
    );
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/not found/i),
    });
    expect(db.attachment.create).not.toHaveBeenCalled();
  });
});

describe("MCP write tools — thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("update_thread archive calls archiveThread", async () => {
    vi.mocked(archiveThread).mockResolvedValue(undefined as never);
    const result = await call("update_thread", {
      messageId: "m1",
      action: "archive",
    });
    expect(archiveThread).toHaveBeenCalledWith("u1", "m1");
    expect(result).toMatchObject({ type: "ok" });
  });

  it("update_thread snooze requires until", async () => {
    const result = await call("update_thread", {
      messageId: "m1",
      action: "snooze",
    });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/until/i),
    });
  });

  it("maps mutation not-found errors to not found or not yours", async () => {
    vi.mocked(archiveThread).mockRejectedValue(new Error("Message not found"));
    const result = await call("update_thread", {
      messageId: "missing",
      action: "archive",
    });
    expect(result).toEqual({
      type: "error",
      message: "not found or not yours",
    });
  });

  it("leaves non-not-found mutation errors unchanged", async () => {
    vi.mocked(archiveThread).mockRejectedValue(
      new Error("Snooze date must be in the future"),
    );
    const result = await call("update_thread", {
      messageId: "m1",
      action: "archive",
    });
    expect(result).toEqual({
      type: "error",
      message: "Snooze date must be in the future",
    });
  });
});

describe("MCP write tools — screener stub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("screen_sender reject without elicitation does not mutate", async () => {
    vi.mocked(db.sender.findFirst).mockResolvedValue({
      email: "spam@example.com",
      displayName: "Spam",
    } as never);
    const result = await call("screen_sender", {
      senderId: "s1",
      action: "reject",
    });
    expect(result).toMatchObject({
      type: "error",
      message: "this client cannot confirm this action",
    });
  });

  it("create_domain_rule with only pattern rejects a cross-connection match", async () => {
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "s1", domain: "acme.com", emailConnectionId: "c1" },
      { id: "s2", domain: "acme.com", emailConnectionId: "c2" },
    ] as never);
    const result = await call("create_domain_rule", {
      pattern: "acme.com",
      includeSubdomains: false,
      status: "APPROVED",
      category: "IMBOX",
    });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/senderId/i),
    });
    expect(createDomainRuleForUser).not.toHaveBeenCalled();
  });

  it("create_domain_rule with only pattern uses a sender when all matches share a connection", async () => {
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "s1", domain: "acme.com", emailConnectionId: "c1" },
      { id: "s2", domain: "mail.acme.com", emailConnectionId: "c1" },
    ] as never);
    vi.mocked(createDomainRuleForUser).mockResolvedValue({
      id: "r1",
      pattern: "acme.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "IMBOX",
    } as never);
    const result = await call("create_domain_rule", {
      pattern: "acme.com",
      includeSubdomains: true,
      status: "APPROVED",
      category: "IMBOX",
    });
    expect(createDomainRuleForUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        senderId: expect.stringMatching(/^s[12]$/),
        pattern: "acme.com",
        includeSubdomains: true,
        status: "APPROVED",
        category: "IMBOX",
      }),
    );
    expect(result.type).toBe("ok");
  });

  it("create_domain_rule with only pattern says there is no sender on that domain", async () => {
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "s1", domain: "other.com", emailConnectionId: "c1" },
    ] as never);
    const result = await call("create_domain_rule", {
      pattern: "acme.com",
      includeSubdomains: false,
      status: "APPROVED",
      category: "IMBOX",
    });
    expect(result).toMatchObject({
      type: "error",
      message: expect.stringMatching(/no sender on that domain/i),
    });
    expect(result).not.toMatchObject({
      message: "not found or not yours",
    });
    expect(createDomainRuleForUser).not.toHaveBeenCalled();
  });
});
