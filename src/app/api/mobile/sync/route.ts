import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { MESSAGE_SELECT } from "@/lib/mobile/message-select";

/**
 * GET /api/mobile/sync?cursor=<updatedAtISO>_<id>&limit=500
 *
 * Delta-sync for mobile clients. Returns message metadata (no bodies),
 * senders, tombstones, and the set of active connection ids.
 *
 * Cursor semantics: compound (updatedAt, id) so rows sharing a timestamp are
 * never skipped across page boundaries. Pagination applies to messages (the
 * large table); senders and tombstones are filtered by the cursor's timestamp
 * only and re-sent until the cursor advances past them — client upserts make
 * that harmless.
 *
 * No cursor = initial full backfill (paged).
 */

const MAX_LIMIT = 500;

const SENDER_SELECT = {
  id: true,
  updatedAt: true,
  email: true,
  displayName: true,
  domain: true,
  status: true,
  category: true,
  skippedUntil: true,
  unthread: true,
  messageCount: true,
  emailConnectionId: true,
} as const;

function parseCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("_");
  if (sep === -1) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

function formatCursor(at: Date, id: string): string {
  return `${at.toISOString()}_${id}`;
}

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limitCheck = await rateLimitUser(userId);
  if (!limitCheck.allowed) return tooManyRequests(limitCheck.retryAfter);

  const cursorParam = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCursor(cursorParam);
  if (cursorParam && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? MAX_LIMIT);
  const limit = Math.min(
    Math.max(1, isNaN(limitParam) ? MAX_LIMIT : limitParam),
    MAX_LIMIT,
  );

  const afterCursor = cursor
    ? {
        OR: [
          { updatedAt: { gt: cursor.at } },
          { updatedAt: cursor.at, id: { gt: cursor.id } },
        ],
      }
    : {};

  const [messages, senders, tombstones, connections] = await Promise.all([
    db.message.findMany({
      where: { userId, ...afterCursor },
      select: MESSAGE_SELECT,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    }),
    db.sender.findMany({
      where: { userId, ...(cursor ? { updatedAt: { gt: cursor.at } } : {}) },
      select: SENDER_SELECT,
      orderBy: { updatedAt: "asc" },
    }),
    db.messageTombstone.findMany({
      where: { userId, ...(cursor ? { deletedAt: { gt: cursor.at } } : {}) },
      select: { messageId: true },
    }),
    db.emailConnection.findMany({
      where: { userId },
      select: { id: true, email: true, displayName: true, isDefault: true },
    }),
  ]);

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  // Advance the cursor to the last returned message. When the message stream
  // is drained, advance the timestamp to the newest sender we saw so senders
  // are not re-sent forever; never move backwards past the incoming cursor.
  let nextCursor = cursorParam ?? formatCursor(new Date(0), "");
  if (page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = formatCursor(last.updatedAt, last.id);
  }
  if (!hasMore && senders.length > 0) {
    const lastSenderAt = senders[senders.length - 1].updatedAt;
    const current = parseCursor(nextCursor);
    if (!current || lastSenderAt > current.at) {
      nextCursor = formatCursor(lastSenderAt, "");
    }
  }

  return NextResponse.json({
    messages: page,
    senders,
    deletedMessageIds: tombstones.map((t) => t.messageId),
    connections,
    nextCursor,
    hasMore,
  });
}
