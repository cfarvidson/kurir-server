import { DraftType, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSyncQueue } from "@/lib/jobs/queue";
import {
  deleteDraftForUser,
  saveDraftForUser,
  saveDraftSchema,
} from "@/lib/mail/drafts";
import {
  findReplyDraftForThread,
  loadDraftContextMessage,
  prepareDraftSave,
  presentDraft,
  presentDraftsForUser,
} from "@/lib/mail/draft-presentation";
import { getFiles } from "@/lib/mail/files";
import {
  encodeChronoCursor,
  getMessages,
  parseChronoCursor,
  type Category,
} from "@/lib/mail/messages";
import {
  archiveThread,
  dismissThreadFollowUp,
  setThreadFollowUp,
  setThreadReadState,
  setThreadReplyLater,
  snoozeThread,
  unarchiveThread,
  unsnoozeThread,
} from "@/lib/mail/mutations";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import {
  cancelScheduledForUser,
  updateScheduledForUser,
} from "@/lib/mail/scheduled-messages";
import { searchMessages } from "@/lib/mail/search";
import { getSidebarCounts } from "@/lib/mail/sidebar-counts";
import { getThreadMessages } from "@/lib/mail/threads";
import { getOwnAddresses } from "@/lib/mail/user-emails";
import { asBodyBytes, storedContentToBuffer } from "@/lib/mail/attachment-bytes";
import { uploadPendingAttachment } from "@/lib/mail/attachment-upload";
import { downloadAttachmentContent } from "@/lib/mail/attachment-helpers";
import { isPdf, normalizeContentType } from "@/lib/mail/attachment-types";
import { MESSAGE_SELECT } from "@/lib/mobile/message-select";
import {
  formatFrom,
  serializeMailRow,
  serializeThreadMessage,
  type MailRowInput,
} from "@/lib/mcp/serialize";
import {
  bumpSidebarCounts,
  err,
  firstZodMessage,
  ok,
  wrap,
} from "@/lib/mcp/tools/helpers";
import { rateLimitSync } from "@/lib/rate-limit";
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

const THREAD_ACTIONS = [
  "archive",
  "unarchive",
  "read",
  "unread",
  "snooze",
  "unsnooze",
  "follow_up",
  "dismiss_follow_up",
  "reply_later",
  "clear_reply_later",
] as const;

const updateThreadSchema = z.object({
  messageId: z.string().min(1),
  action: z.enum(THREAD_ACTIONS),
  until: z.string().optional(),
});

const draftKeySchema = z.object({
  type: z.enum(["NEW", "REPLY", "FORWARD"]),
  contextMessageId: z.string().min(1),
});

const updateScheduledSchema = z.object({
  id: z.string().min(1),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  scheduledFor: z.string().optional(),
});

const cancelScheduledSchema = z.object({
  id: z.string().min(1),
});

const uploadAttachmentSchema = z.object({
  filename: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  data: z.string().min(1).optional(),
  uploadId: z.string().min(1).optional(),
  done: z.boolean().optional(),
});

const syncMailSchema = z.object({
  connectionId: z.string().optional(),
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
      "Load one attachment the user owns. Small text, jpeg/png/gif/webp, and PDF files (under 1 MB) are inlined as text or base64; larger files return openInApp.",
    inputSchema: {
      type: "object",
      properties: { attachmentId: { type: "string" } },
      required: ["attachmentId"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getAttachment),
  });

  registerTool({
    name: "update_thread",
    description:
      "Archive, unarchive, mark read/unread, snooze, follow up, or reply-later a thread. until is required for snooze and follow_up.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        action: { type: "string", enum: [...THREAD_ACTIONS] },
        until: { type: "string", description: "ISO-8601 datetime" },
      },
      required: ["messageId", "action"],
    },
    handler: wrap(updateThread),
  });

  registerTool({
    name: "save_draft",
    description:
      "Save a draft. It appears in the user's Drafts folder and on the thread. For a reply use type REPLY and contextMessageId = the message id from get_thread (the id field, not threadId). For new mail use type NEW and a client UUID. Do not write the email only in chat.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["NEW", "REPLY", "FORWARD"] },
        contextMessageId: { type: "string" },
        to: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        emailConnectionId: { type: "string" },
        attachmentIds: { type: "array", items: { type: "string" } },
      },
      required: ["type", "contextMessageId"],
    },
    handler: wrap(saveDraft),
  });

  registerTool({
    name: "delete_draft",
    description:
      "Delete a draft by the same type + contextMessageId key the PWA uses.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["NEW", "REPLY", "FORWARD"] },
        contextMessageId: { type: "string" },
      },
      required: ["type", "contextMessageId"],
    },
    handler: wrap(deleteDraft),
  });

  registerTool({
    name: "update_scheduled",
    description:
      "Edit a pending scheduled message (to/cc/bcc, subject, body, scheduledFor).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        to: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        textBody: { type: "string" },
        htmlBody: { type: "string" },
        scheduledFor: { type: "string" },
      },
      required: ["id"],
    },
    handler: wrap(updateScheduled),
  });

  registerTool({
    name: "cancel_scheduled",
    description: "Cancel a pending scheduled message.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: wrap(cancelScheduled),
  });

  registerTool({
    name: "upload_attachment",
    description:
      "Upload a file as a pending attachment. Returns { id } for send_mail.attachmentIds. Never send more than ~250000 raw file bytes (~350000 base64 chars) in one call - a 1.5 MB PDF cannot travel as a single tool argument. For larger files, slice the raw bytes (not the base64 string) and upload each slice: first call filename+contentType+data+done=false (returns uploadId); next calls uploadId+data+done=false; last call uploadId+data+done=true (returns id). Each data value is base64 of that slice. Accepts raw base64, base64url, or a data: URL. Max 5 MB decoded.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Required on the first chunk",
        },
        contentType: {
          type: "string",
          description: "Required on the first chunk",
        },
        data: {
          type: "string",
          description:
            "Base64-encoded chunk. Omit only on a final done=true call that just closes the session.",
        },
        uploadId: {
          type: "string",
          description: "From the first done=false response; required to continue",
        },
        done: {
          type: "boolean",
          description:
            "Default true (single-shot). false keeps the session open for more chunks.",
        },
      },
    },
    handler: wrap(uploadAttachment),
  });

  registerTool({
    name: "sync_mail",
    description:
      "Start an IMAP sync for one connection or all of the user's connections. Returns immediately with current status.",
    inputSchema: {
      type: "object",
      properties: { connectionId: { type: "string" } },
    },
    handler: wrap(syncMail),
  });

  registerTool({
    name: "get_sync_status",
    description: "Current IMAP sync status for one or all connections.",
    inputSchema: {
      type: "object",
      properties: { connectionId: { type: "string" } },
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getSyncStatus),
  });
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
    if (messages.length === 0) {
      return pageResult([], result.nextCursor);
    }
    // getMessages omits toAddresses and category flags; merge a compact select
    // so list rows match the spec without changing the PWA MESSAGE_SELECT.
    const extras = await db.message.findMany({
      where: {
        userId: ctx.userId,
        id: { in: messages.map((m) => m.id) },
        ...(ownedConnectionId ? { emailConnectionId: ownedConnectionId } : {}),
      },
      select: compactSelect,
    });
    const byId = new Map(extras.map((row) => [row.id, row]));
    const rows = messages.flatMap((m) => {
      const extra = byId.get(m.id);
      return extra ? [extra] : [];
    });
    return pageResult(
      rows.map((m) => serializeMailRow(m)),
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
        cursor,
        connectionId: ownedConnectionId,
      });
    case "drafts":
      return listDrafts(ctx.userId, ownedConnectionId);
    case "scheduled":
      return listScheduled(ctx.userId, {
        limit,
        cursor,
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
  opts: { limit: number; cursor?: string; connectionId?: string },
): Promise<ToolResult> {
  const cursorCondition = opts.cursor
    ? parseDescIsoIdCursor(opts.cursor, "createdAt")
    : undefined;
  if (opts.cursor && !cursorCondition) {
    return { type: "error", message: "Invalid cursor" };
  }
  const own = await getOwnAddresses(userId);
  const senders = await db.sender.findMany({
    where: {
      ...visiblePendingSenderWhere(userId, own),
      ...(opts.connectionId ? { emailConnectionId: opts.connectionId } : {}),
      ...cursorCondition,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
  const nextCursor =
    senders.length === opts.limit && last
      ? encodeIsoIdCursor(last.createdAt, last.id)
      : null;
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
  const drafts = await presentDraftsForUser(userId);
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
      displaySubject: draft.displaySubject,
      displayFrom: draft.displayFrom,
      folder: draft.folder,
    })),
  );
}

async function listScheduled(
  userId: string,
  opts: { limit: number; cursor?: string; connectionId?: string },
): Promise<ToolResult> {
  const cursorCondition = opts.cursor
    ? parseAscIsoIdCursor(opts.cursor, "scheduledFor")
    : undefined;
  if (opts.cursor && !cursorCondition) {
    return { type: "error", message: "Invalid cursor" };
  }
  const rows = await db.scheduledMessage.findMany({
    where: {
      userId,
      ...(opts.connectionId ? { emailConnectionId: opts.connectionId } : {}),
      ...cursorCondition,
    },
    orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
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
  const nextCursor =
    rows.length === opts.limit && last
      ? encodeIsoIdCursor(last.scheduledFor, last.id)
      : null;
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
  const draftRow = await findReplyDraftForThread(
    ctx.userId,
    result.messages.map((m) => m.id),
  );
  let draft = null;
  if (draftRow) {
    const context = await loadDraftContextMessage(
      ctx.userId,
      draftRow.contextMessageId,
    );
    const presented = presentDraft(draftRow, context);
    draft = {
      type: draftRow.type,
      contextMessageId: draftRow.contextMessageId,
      to: draftRow.to,
      cc: draftRow.cc,
      bcc: draftRow.bcc,
      subject: draftRow.subject,
      body: draftRow.body,
      updatedAt: draftRow.updatedAt.toISOString(),
      ...presented,
    };
  }
  return {
    type: "ok",
    structuredContent: {
      messages: result.messages.map((m) =>
        serializeThreadMessage(m as MailRowInput),
      ),
      draft,
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
    include: {
      message: {
        select: {
          userId: true,
          uid: true,
          emailConnectionId: true,
          folder: { select: { path: true } },
        },
      },
    },
  });
  if (!attachment || !isAttachmentOwner(attachment, ctx.userId)) {
    return { type: "error", message: "not found or not yours" };
  }

  let content = storedContentToBuffer(attachment.content);
  if (!content) {
    const fetched = await downloadAttachmentContent({
      partId: attachment.partId,
      message: attachment.message,
    });
    if (fetched) {
      content = asBodyBytes(fetched);
      db.attachment
        .update({
          where: { id: attachment.id },
          data: { content: asBodyBytes(fetched), size: fetched.length },
        })
        .catch(() => {});
    }
  }
  if (!content) {
    return err("Attachment content not available");
  }
  const size = Math.max(attachment.size, content.length);
  const meta = {
    filename: attachment.filename,
    contentType: attachment.contentType,
    size,
  };
  if (!canInline(attachment.contentType, size)) {
    return {
      type: "ok",
      structuredContent: { openInApp: true, ...meta },
    };
  }

  const ct = normalizeContentType(attachment.contentType);
  const encoded = Buffer.from(content);
  if (ct.startsWith("text/")) {
    return {
      type: "ok",
      structuredContent: { ...meta, text: encoded.toString("utf8") },
    };
  }
  return {
    type: "ok",
    structuredContent: { ...meta, data: encoded.toString("base64") },
  };
}

async function updateThread(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateThreadSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const { messageId, action } = parsed.data;
  const until = parseUntil(parsed.data.until);

  switch (action) {
    case "archive":
      await archiveThread(ctx.userId, messageId);
      break;
    case "unarchive":
      await unarchiveThread(ctx.userId, messageId);
      break;
    case "read":
      await setThreadReadState(ctx.userId, messageId, true);
      break;
    case "unread":
      await setThreadReadState(ctx.userId, messageId, false);
      break;
    case "snooze":
      if (!until) return err("until is required for snooze");
      await snoozeThread(ctx.userId, messageId, until);
      break;
    case "unsnooze":
      await unsnoozeThread(ctx.userId, messageId);
      break;
    case "follow_up":
      if (!until) return err("until is required for follow_up");
      await setThreadFollowUp(ctx.userId, messageId, until);
      break;
    case "dismiss_follow_up":
      await dismissThreadFollowUp(ctx.userId, messageId);
      break;
    case "reply_later":
      await setThreadReplyLater(ctx.userId, messageId, true);
      break;
    case "clear_reply_later":
      await setThreadReplyLater(ctx.userId, messageId, false);
      break;
  }

  bumpSidebarCounts();
  return ok({ ok: true, messageId, action });
}

function parseUntil(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid until datetime");
  return date;
}

async function saveDraft(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = saveDraftSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const prepared = await prepareDraftSave(ctx.userId, parsed.data);
  if (!prepared.ok) return err(prepared.message);
  const draft = await saveDraftForUser(ctx.userId, prepared.input);
  return ok({
    id: draft.id,
    type: draft.type,
    contextMessageId: draft.contextMessageId,
    ...presentDraft(draft, prepared.message),
  });
}

async function deleteDraft(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = draftKeySchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  await deleteDraftForUser(
    ctx.userId,
    parsed.data.type as DraftType,
    parsed.data.contextMessageId,
  );
  return ok({ ok: true });
}

async function updateScheduled(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateScheduledSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const { id, body, textBody, ...rest } = parsed.data;
  const result = await updateScheduledForUser(ctx.userId, id, {
    ...rest,
    textBody: textBody ?? body,
  });
  bumpSidebarCounts();
  return ok({
    id: result.id,
    scheduledFor: result.scheduledFor.toISOString(),
  });
}

async function cancelScheduled(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = cancelScheduledSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const result = await cancelScheduledForUser(ctx.userId, parsed.data.id);
  if (result === "not_found") return err("not found or not yours");
  if (result === "not_pending") {
    return err("Only PENDING messages can be cancelled");
  }
  bumpSidebarCounts();
  return ok({ ok: true });
}

async function uploadAttachment(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = uploadAttachmentSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const result = await uploadPendingAttachment(ctx.userId, parsed.data);
  if (!result.ok) return err(result.error);
  if (!result.complete) {
    return ok({
      uploadId: result.uploadId,
      receivedBytes: result.receivedBytes,
      complete: false,
    });
  }
  return ok({ id: result.id, complete: true });
}

async function syncMail(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = syncMailSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const rl = await rateLimitSync(ctx.userId);
  if (!rl.allowed) {
    return err(`Too many syncs — try again in ${rl.retryAfter} seconds`);
  }

  const connections = await loadOwnedConnections(
    ctx.userId,
    parsed.data.connectionId,
  );
  if (connections.length === 0) {
    return err(
      parsed.data.connectionId
        ? "not found or not yours"
        : "No email connections found",
    );
  }

  const queue = getSyncQueue();
  for (const conn of connections) {
    await queue.add(
      "sync",
      { emailConnectionId: conn.id, userId: ctx.userId },
      { jobId: `mcp-sync-${conn.id}-${Date.now()}`, priority: 1 },
    );
  }

  return ok(await serializeSyncStatus(connections));
}

async function getSyncStatus(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = syncMailSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const connections = await loadOwnedConnections(
    ctx.userId,
    parsed.data.connectionId,
  );
  if (parsed.data.connectionId && connections.length === 0) {
    return err("not found or not yours");
  }
  return ok(await serializeSyncStatus(connections));
}

async function loadOwnedConnections(userId: string, connectionId?: string) {
  return db.emailConnection.findMany({
    where: { userId, ...(connectionId ? { id: connectionId } : {}) },
    select: {
      id: true,
      email: true,
      syncState: {
        select: {
          isSyncing: true,
          lastFullSync: true,
          syncError: true,
          syncStartedAt: true,
        },
      },
    },
  });
}

async function serializeSyncStatus(
  connections: Array<{
    id: string;
    email: string;
    syncState: {
      isSyncing: boolean;
      lastFullSync: Date | null;
      syncError: string | null;
      syncStartedAt: Date | null;
    } | null;
  }>,
) {
  return {
    connections: connections.map((conn) => ({
      connectionId: conn.id,
      email: conn.email,
      isSyncing: conn.syncState?.isSyncing ?? false,
      lastFullSync: conn.syncState?.lastFullSync?.toISOString() ?? null,
      syncStartedAt: conn.syncState?.syncStartedAt?.toISOString() ?? null,
      syncError: conn.syncState?.syncError ?? null,
    })),
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
  return ct.startsWith("text/") || INLINE_IMAGES.has(ct) || isPdf(ct);
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

function isCategoryView(view: string): view is CategoryView {
  return view in CATEGORY_VIEWS;
}

function isSpecialView(view: string): view is SpecialView {
  return (SPECIAL_VIEWS as readonly string[]).includes(view);
}

function encodeIsoIdCursor(date: Date, id: string): string {
  return `${date.toISOString()}_${id}`;
}

function parseIsoIdCursor(cursor: string): { date: Date; id: string } | null {
  const lastUnderscore = cursor.lastIndexOf("_");
  if (lastUnderscore === -1) return null;
  const date = new Date(cursor.substring(0, lastUnderscore));
  const id = cursor.substring(lastUnderscore + 1);
  if (Number.isNaN(date.getTime())) return null;
  if (!/^c[a-z0-9]{20,}$/.test(id)) return null;
  return { date, id };
}

function parseDescIsoIdCursor(
  cursor: string,
  field: "createdAt",
): { OR: Array<Record<string, unknown>> } | null {
  const parsed = parseIsoIdCursor(cursor);
  if (!parsed) return null;
  return {
    OR: [
      { [field]: { lt: parsed.date } },
      { [field]: parsed.date, id: { lt: parsed.id } },
    ],
  };
}

function parseAscIsoIdCursor(
  cursor: string,
  field: "scheduledFor",
): { OR: Array<Record<string, unknown>> } | null {
  const parsed = parseIsoIdCursor(cursor);
  if (!parsed) return null;
  return {
    OR: [
      { [field]: { gt: parsed.date } },
      { [field]: parsed.date, id: { gt: parsed.id } },
    ],
  };
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
