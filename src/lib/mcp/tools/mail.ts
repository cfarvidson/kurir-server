import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { listDraftsForUser } from "@/lib/mail/drafts";
import { getFiles } from "@/lib/mail/files";
import {
  encodeChronoCursor,
  getMessages,
  parseChronoCursor,
  type Category,
} from "@/lib/mail/messages";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { searchMessages } from "@/lib/mail/search";
import { getSidebarCounts } from "@/lib/mail/sidebar-counts";
import { getThreadMessages } from "@/lib/mail/threads";
import { getOwnAddresses } from "@/lib/mail/user-emails";
import { normalizeContentType } from "@/lib/mail/attachment-types";
import { MESSAGE_SELECT } from "@/lib/mobile/message-select";
import {
  formatFrom,
  serializeMailRow,
  serializeThreadMessage,
  type MailRowInput,
} from "@/lib/mcp/serialize";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_LIMIT = 50;
const INLINE_MAX_BYTES = 1_000_000;
const INLINE_IMAGES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const CATEGORY_VIEWS = {
  imbox: "imbox",
  feed: "feed",
  archive: "archive",
  snoozed: "snoozed",
  paper_trail: "paper-trail",
  follow_up: "follow-up",
  reply_later: "reply-later",
} as const;

const SPECIAL_VIEWS = [
  "screener",
  "sent",
  "drafts",
  "scheduled",
  "files",
] as const;

type CategoryView = keyof typeof CATEGORY_VIEWS;
type SpecialView = (typeof SPECIAL_VIEWS)[number];

const listMailSchema = z.object({
  view: z.string(),
  cursor: z.string().optional(),
  unreadOnly: z.boolean().optional(),
  connectionId: z.string().optional(),
  limit: z.number().int().optional(),
});

const getThreadSchema = z.object({
  messageId: z.string().min(1),
});

const searchMailSchema = z.object({
  q: z.string().min(1),
  limit: z.number().int().optional(),
});

const getAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});

export function registerMailTools(registerTool: (def: ToolDef) => void): void {
  registerTool({
    name: "list_mail",
    description:
      "List mail in a Kurir view (imbox, feed, paper_trail, screener, archive, sent, snoozed, follow_up, reply_later, drafts, scheduled, files). Returns compact rows, never HTML bodies.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: [...Object.keys(CATEGORY_VIEWS), ...SPECIAL_VIEWS],
        },
        cursor: { type: "string" },
        unreadOnly: { type: "boolean" },
        connectionId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["view"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(listMail),
  });

  registerTool({
    name: "get_thread",
    description:
      "Fetch a thread by any message id, in chronological order, as sanitized plain text plus attachment metadata.",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getThread),
  });

  registerTool({
    name: "search_mail",
    description:
      "Full-text search across the user's mail. Results are compact rows in FTS rank order.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["q"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(searchMail),
  });

  registerTool({
    name: "get_counts",
    description:
      "Sidebar counts for the signed-in user (same source as the PWA).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(getCounts),
  });

  registerTool({
    name: "get_attachment",
    description:
      "Load one attachment the user owns. Small text and jpeg/png/gif/webp files are inlined; everything else returns openInApp.",
    inputSchema: {
      type: "object",
      properties: { attachmentId: { type: "string" } },
      required: ["attachmentId"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getAttachment),
  });
}

function wrap(
  handler: (
    ctx: ToolContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>,
): ToolDef["handler"] {
  return async (ctx, args) => {
    try {
      return await handler(ctx, args);
    } catch (error) {
      return {
        type: "error",
        message: error instanceof Error ? error.message : "Tool failed",
      };
    }
  };
}

async function listMail(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = listMailSchema.safeParse(args);
  if (!parsed.success) {
    return { type: "error", message: firstZodMessage(parsed.error) };
  }
  const { view, cursor, unreadOnly, connectionId } = parsed.data;
  const limit = clampLimit(parsed.data.limit, DEFAULT_LIST_LIMIT);
  const ownedConnectionId = await requireOwnedConnection(
    ctx.userId,
    connectionId,
  );

  if (isCategoryView(view)) {
    const result = await getMessages(
      ctx.userId,
      CATEGORY_VIEWS[view] as Category,
      limit,
      cursor,
    );
    if (!result) return { type: "error", message: "Invalid cursor" };
    let messages = result.messages as MailRowInput[];
    if (unreadOnly) {
      messages = messages.filter((m) => !m.isRead);
    }
    if (ownedConnectionId && messages.length > 0) {
      const owned = await db.message.findMany({
        where: {
          userId: ctx.userId,
          emailConnectionId: ownedConnectionId,
          id: { in: messages.map((m) => m.id) },
        },
        select: { id: true },
      });
      const allowed = new Set(owned.map((row) => row.id));
      messages = messages.filter((m) => allowed.has(m.id));
    }
    return pageResult(
      messages.map((m) => serializeMailRow(m)),
      result.nextCursor,
    );
  }

  if (!isSpecialView(view)) {
    return { type: "error", message: `Unknown view: ${view}` };
  }

  switch (view) {
    case "sent":
      return listSent(ctx.userId, {
        limit,
        cursor,
        unreadOnly,
        connectionId: ownedConnectionId,
      });
    case "screener":
      return listScreener(ctx.userId, {
        limit,
        connectionId: ownedConnectionId,
      });
    case "drafts":
      return listDrafts(ctx.userId, ownedConnectionId);
    case "scheduled":
      return listScheduled(ctx.userId, {
        limit,
        connectionId: ownedConnectionId,
      });
    case "files":
      return listFilesView(ctx.userId, { limit, cursor });
  }
}

async function listSent(
  userId: string,
  opts: {
    limit: number;
    cursor?: string;
    unreadOnly?: boolean;
    connectionId?: string;
  },
): Promise<ToolResult> {
  const cursorCondition = opts.cursor
    ? parseChronoCursor(opts.cursor)
    : undefined;
  if (opts.cursor && !cursorCondition) {
    return { type: "error", message: "Invalid cursor" };
  }
  const messages = await db.message.findMany({
    where: {
      userId,
      folder: { specialUse: "sent" },
      ...(opts.unreadOnly ? { isRead: false } : {}),
      ...(opts.connectionId ? { emailConnectionId: opts.connectionId } : {}),
      ...cursorCondition,
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: opts.limit,
    select: compactSelect,
  });
  const last = messages[messages.length - 1];
  const nextCursor =
    messages.length === opts.limit && last ? encodeChronoCursor(last) : null;
  return pageResult(
    messages.map((m) => serializeMailRow(m)),
    nextCursor,
  );
}

async function listScreener(
  userId: string,
  opts: { limit: number; connectionId?: string },
): Promise<ToolResult> {
  const own = await getOwnAddresses(userId);
  const senders = await db.sender.findMany({
    where: {
      ...visiblePendingSenderWhere(userId, own),
      ...(opts.connectionId ? { emailConnectionId: opts.connectionId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit,
    include: {
      messages: {
        where: { isArchived: false },
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: {
          id: true,
          subject: true,
          snippet: true,
          receivedAt: true,
          isRead: true,
          threadId: true,
          fromAddress: true,
          fromName: true,
          toAddresses: true,
          isInImbox: true,
          isInFeed: true,
          isInPaperTrail: true,
          isArchived: true,
          isInScreener: true,
        },
      },
    },
  });
  const last = senders[senders.length - 1];
  const nextCursor = senders.length === opts.limit && last ? last.id : null;
  const items = senders.map((sender) => {
    const latest = sender.messages[0];
    if (latest) {
      return serializeMailRow({
        ...latest,
        fromAddress: latest.fromAddress || sender.email,
        fromName: latest.fromName ?? sender.displayName,
      });
    }
    return serializeMailRow({
      id: sender.id,
      fromAddress: sender.email,
      fromName: sender.displayName,
      subject: null,
      snippet: null,
      receivedAt: sender.createdAt,
      isRead: false,
      isInScreener: true,
    });
  });
  return pageResult(items, nextCursor);
}

async function listDrafts(
  userId: string,
  connectionId?: string,
): Promise<ToolResult> {
  const drafts = await listDraftsForUser(userId);
  const filtered = connectionId
    ? drafts.filter((d) => d.emailConnectionId === connectionId)
    : drafts;
  return pageResult(
    filtered.map((draft) => ({
      id: draft.id,
      type: draft.type,
      contextMessageId: draft.contextMessageId,
      from: "",
      to: draft.to ? [draft.to] : [],
      subject: draft.subject || null,
      date: draft.updatedAt.toISOString(),
      snippet: draft.body ? draft.body.slice(0, 150) : null,
      isRead: true,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      isInScreener: false,
    })),
  );
}

async function listScheduled(
  userId: string,
  opts: { limit: number; connectionId?: string },
): Promise<ToolResult> {
  const rows = await db.scheduledMessage.findMany({
    where: {
      userId,
      ...(opts.connectionId ? { emailConnectionId: opts.connectionId } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    take: opts.limit,
    select: {
      id: true,
      to: true,
      cc: true,
      subject: true,
      scheduledFor: true,
      status: true,
    },
  });
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === opts.limit && last ? last.id : null;
  return pageResult(
    rows.map((row) => ({
      id: row.id,
      from: "",
      to: row.to ? [row.to] : [],
      subject: row.subject || null,
      date: row.scheduledFor.toISOString(),
      snippet: null,
      isRead: true,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      isInScreener: false,
      scheduledFor: row.scheduledFor.toISOString(),
      status: row.status,
    })),
    nextCursor,
  );
}

async function listFilesView(
  userId: string,
  opts: { limit: number; cursor?: string },
): Promise<ToolResult> {
  const result = await getFiles(userId, {
    limit: opts.limit,
    cursor: opts.cursor,
  });
  if (!result) return { type: "error", message: "Invalid cursor" };
  return pageResult(
    result.files.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      date: file.createdAt.toISOString(),
      subject: file.message?.subject ?? null,
      from: formatFrom(file.message?.fromName, file.message?.fromAddress),
      messageId: file.message?.id ?? null,
    })),
    result.nextCursor,
  );
}

async function getThread(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getThreadSchema.safeParse(args);
  if (!parsed.success) {
    return { type: "error", message: firstZodMessage(parsed.error) };
  }
  const result = await getThreadMessages(ctx.userId, parsed.data.messageId);
  if (!result) {
    return { type: "error", message: "not found or not yours" };
  }
  return {
    type: "ok",
    structuredContent: {
      messages: result.messages.map((m) =>
        serializeThreadMessage(m as MailRowInput),
      ),
    },
  };
}

async function searchMail(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = searchMailSchema.safeParse(args);
  if (!parsed.success) {
    return { type: "error", message: firstZodMessage(parsed.error) };
  }
  const q = parsed.data.q.trim();
  if (!q) return { type: "error", message: "Missing query" };
  const limit = clampLimit(parsed.data.limit, DEFAULT_SEARCH_LIMIT);
  const hits = await searchMessages(ctx.userId, q, Prisma.empty, limit);
  if (hits.length === 0) return pageResult([]);

  const rows = await db.message.findMany({
    where: { userId: ctx.userId, id: { in: hits.map((h) => h.id) } },
    select: MESSAGE_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = hits.flatMap((hit) => {
    const row = byId.get(hit.id);
    return row ? [serializeMailRow(row as MailRowInput)] : [];
  });
  return pageResult(items);
}

async function getCounts(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const counts = await getSidebarCounts(ctx.userId);
  return { type: "ok", structuredContent: counts };
}

async function getAttachment(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getAttachmentSchema.safeParse(args);
  if (!parsed.success) {
    return { type: "error", message: firstZodMessage(parsed.error) };
  }
  const attachment = await db.attachment.findUnique({
    where: { id: parsed.data.attachmentId },
    include: { message: { select: { userId: true } } },
  });
  if (!attachment || !isAttachmentOwner(attachment, ctx.userId)) {
    return { type: "error", message: "not found or not yours" };
  }

  const meta = {
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
  };
  const inlineable = canInline(attachment.contentType, attachment.size);
  const content = toBuffer(attachment.content);
  if (!inlineable || !content) {
    return {
      type: "ok",
      structuredContent: { openInApp: true, ...meta },
    };
  }

  const ct = normalizeContentType(attachment.contentType);
  if (ct.startsWith("text/")) {
    return {
      type: "ok",
      structuredContent: { ...meta, text: content.toString("utf8") },
    };
  }
  return {
    type: "ok",
    structuredContent: { ...meta, data: content.toString("base64") },
  };
}

async function requireOwnedConnection(
  userId: string,
  connectionId?: string,
): Promise<string | undefined> {
  if (!connectionId) return undefined;
  const row = await db.emailConnection.findFirst({
    where: { id: connectionId, userId },
    select: { id: true },
  });
  if (!row) throw new Error("not found or not yours");
  return row.id;
}

function isAttachmentOwner(
  attachment: { userId: string | null; message: { userId: string } | null },
  userId: string,
): boolean {
  return attachment.userId === userId || attachment.message?.userId === userId;
}

function canInline(contentType: string, size: number): boolean {
  if (size > INLINE_MAX_BYTES) return false;
  const ct = normalizeContentType(contentType);
  return ct.startsWith("text/") || INLINE_IMAGES.has(ct);
}

function toBuffer(content: unknown): Buffer | null {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  return null;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function pageResult(items: unknown[], nextCursor?: string | null): ToolResult {
  return {
    type: "ok",
    structuredContent: nextCursor ? { items, nextCursor } : { items },
  };
}

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid arguments";
}

function isCategoryView(view: string): view is CategoryView {
  return view in CATEGORY_VIEWS;
}

function isSpecialView(view: string): view is SpecialView {
  return (SPECIAL_VIEWS as readonly string[]).includes(view);
}

const compactSelect = {
  id: true,
  threadId: true,
  fromAddress: true,
  fromName: true,
  toAddresses: true,
  subject: true,
  receivedAt: true,
  snippet: true,
  isRead: true,
  isInImbox: true,
  isInFeed: true,
  isInPaperTrail: true,
  isArchived: true,
  isInScreener: true,
  snoozedUntil: true,
  followUpAt: true,
  isReplyLater: true,
} as const;
