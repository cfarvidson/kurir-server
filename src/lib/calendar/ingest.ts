import { db } from "@/lib/db";
import { isCalendarPart, parseIcs } from "@/lib/calendar/ics";

/** Subset of mailparser ParsedMail used during ICS ingest. */
export type IngestParsedLike = {
  attachments?: Array<{
    contentType?: string | null;
    filename?: string | null;
    content?: unknown;
  }> | null;
  text?: string | null;
  headers?:
    | Map<string, unknown>
    | { get?: (key: string) => unknown }
    | null;
};

function contentToString(content: unknown): string | null {
  if (content == null) return null;
  if (typeof content === "string") {
    return content.length > 0 ? content : null;
  }
  if (Buffer.isBuffer(content)) {
    return content.byteLength > 0 ? content.toString("utf8") : null;
  }
  if (content instanceof Uint8Array) {
    return content.byteLength > 0
      ? Buffer.from(content).toString("utf8")
      : null;
  }
  return null;
}

function headerContentType(parsed: IngestParsedLike): string | null {
  const headers = parsed.headers;
  if (!headers) return null;
  const raw =
    typeof (headers as { get?: (k: string) => unknown }).get === "function"
      ? (headers as { get: (k: string) => unknown }).get("content-type")
      : null;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "value" in raw &&
    typeof (raw as { value: unknown }).value === "string"
  ) {
    return (raw as { value: string }).value;
  }
  return null;
}

/** First calendar MIME part body from attachments or root text/calendar. */
function extractCalendarRaw(parsed: IngestParsedLike): string | null {
  const attachments = parsed.attachments ?? [];
  for (const att of attachments) {
    const contentType = att.contentType ?? "";
    const filename = att.filename ?? null;
    if (!isCalendarPart(contentType, filename)) continue;
    const raw = contentToString(att.content);
    if (raw) return raw;
  }

  const rootType = headerContentType(parsed);
  if (rootType && isCalendarPart(rootType, null)) {
    const raw = contentToString(parsed.text);
    if (raw) return raw;
  }

  return null;
}

/**
 * Parse invite ICS from a synced mail message and upsert MessageMeeting.
 * Never throws - bad ICS must not break IMAP sync.
 */
export async function ingestMeetingFromParsed(
  userId: string,
  messageId: string,
  parsed: IngestParsedLike,
): Promise<void> {
  try {
    const raw = extractCalendarRaw(parsed);
    if (raw == null) return;

    const ics = parseIcs(raw);
    if (!ics) {
      // Never log the ICS body.
      console.warn("[calendar-ics] skip");
      return;
    }

    const linked = await db.calendarEvent.findFirst({
      where: { userId, icalUid: ics.uid },
      select: { id: true },
    });

    const fields = {
      uid: ics.uid,
      method: ics.method,
      title: ics.title,
      startAt: ics.startAt,
      endAt: ics.endAt,
      isAllDay: ics.isAllDay,
      location: ics.location,
      organizerEmail: ics.organizerEmail,
      organizerName: ics.organizerName,
      recurrenceId: ics.recurrenceId,
      calendarEventId: linked?.id ?? null,
    };

    await db.messageMeeting.upsert({
      where: { messageId },
      create: {
        ...fields,
        messageId,
        userId,
      },
      update: fields,
    });
  } catch {
    // Swallow all errors so processMessage can finish the mail row.
    console.warn("[calendar-ics] skip");
  }
}
