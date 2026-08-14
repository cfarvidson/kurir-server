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
}));

vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
    sender: { findMany: vi.fn() },
    scheduledMessage: { findMany: vi.fn() },
    attachment: { findUnique: vi.fn() },
    emailConnection: { findFirst: vi.fn() },
  },
}));

import { getMessages } from "@/lib/mail/messages";
import { getThreadMessages } from "@/lib/mail/threads";
import { searchMessages } from "@/lib/mail/search";
import { getSidebarCounts } from "@/lib/mail/sidebar-counts";
import { getFiles } from "@/lib/mail/files";
import { listDraftsForUser } from "@/lib/mail/drafts";
import { db } from "@/lib/db";
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
      subject: "Hello",
      snippet: "Hi",
      isRead: false,
    });
    expect(content.items[0]).not.toHaveProperty("htmlBody");
    expect(content.nextCursor).toBe("cur1");
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
