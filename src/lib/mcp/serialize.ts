export type MailRowInput = {
  id: string;
  threadId?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  toAddresses?: string[] | null;
  ccAddresses?: string[] | null;
  subject?: string | null;
  receivedAt?: Date | string | null;
  sentAt?: Date | string | null;
  snippet?: string | null;
  isRead?: boolean;
  isInImbox?: boolean;
  isInFeed?: boolean;
  isInPaperTrail?: boolean;
  isArchived?: boolean;
  isInScreener?: boolean;
  snoozedUntil?: Date | string | null;
  followUpAt?: Date | string | null;
  isReplyLater?: boolean;
  scheduledFor?: Date | string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }>;
};

export type CompactMailRow = {
  id: string;
  threadId: string | null;
  from: string;
  to: string[];
  subject: string | null;
  date: string;
  snippet: string | null;
  isRead: boolean;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  isInScreener: boolean;
  snoozedUntil?: string;
  followUpUntil?: string;
  replyLater?: boolean;
  scheduledFor?: string;
};

export type ThreadMessageRow = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  subject: string | null;
  text: string;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }>;
};

export function formatFrom(
  name: string | null | undefined,
  address: string | null | undefined,
): string {
  const addr = address ?? "";
  if (name && name.trim()) return `${name} <${addr}>`;
  return addr;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function plainTextFromBodies(msg: {
  textBody?: string | null;
  htmlBody?: string | null;
}): string {
  if (msg.textBody) return msg.textBody;
  if (msg.htmlBody) return stripHtml(msg.htmlBody);
  return "";
}

export function serializeMailRow(msg: MailRowInput): CompactMailRow {
  const row: CompactMailRow = {
    id: msg.id,
    threadId: msg.threadId ?? null,
    from: formatFrom(msg.fromName, msg.fromAddress),
    to: msg.toAddresses ?? [],
    subject: msg.subject ?? null,
    date: toIso(msg.receivedAt ?? msg.sentAt) ?? new Date(0).toISOString(),
    snippet: msg.snippet ?? null,
    isRead: Boolean(msg.isRead),
    isInImbox: Boolean(msg.isInImbox),
    isInFeed: Boolean(msg.isInFeed),
    isInPaperTrail: Boolean(msg.isInPaperTrail),
    isArchived: Boolean(msg.isArchived),
    isInScreener: Boolean(msg.isInScreener),
  };
  const snoozedUntil = toIso(msg.snoozedUntil);
  if (snoozedUntil) row.snoozedUntil = snoozedUntil;
  const followUpUntil = toIso(msg.followUpAt);
  if (followUpUntil) row.followUpUntil = followUpUntil;
  if (msg.isReplyLater) row.replyLater = true;
  const scheduledFor = toIso(msg.scheduledFor);
  if (scheduledFor) row.scheduledFor = scheduledFor;
  return row;
}

export function serializeThreadMessage(msg: MailRowInput): ThreadMessageRow {
  return {
    id: msg.id,
    from: formatFrom(msg.fromName, msg.fromAddress),
    to: msg.toAddresses ?? [],
    cc: msg.ccAddresses ?? [],
    date: toIso(msg.sentAt ?? msg.receivedAt) ?? new Date(0).toISOString(),
    subject: msg.subject ?? null,
    text: plainTextFromBodies(msg),
    attachments: (msg.attachments ?? []).map((att) => ({
      id: att.id,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
    })),
  };
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
