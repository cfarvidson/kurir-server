import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listCalendarAccountsForUser } from "@/lib/calendar/accounts";
import {
  formatSyncCursor,
  invalidRequest,
  parseSyncCursor,
  requireCalendarMobileAuth,
  serializeCalendarAccount,
  serializeSyncEvent,
} from "@/lib/calendar/mobile";

/**
 * GET /api/mobile/calendar/sync?cursor=<updatedAtISO>_<id>&limit=500
 *
 * Delta of calendar events + tombstones. Accounts (with nested calendars)
 * are the full replace-all set, same idea as mail connections.
 */

const MAX_LIMIT = 500;

const EVENT_SELECT = {
  id: true,
  calendarId: true,
  title: true,
  description: true,
  location: true,
  startAt: true,
  endAt: true,
  isAllDay: true,
  timezone: true,
  status: true,
  transparency: true,
  rrule: true,
  rdate: true,
  exdate: true,
  icalUid: true,
  masterEventId: true,
  recurrenceId: true,
  updatedAt: true,
  sequence: true,
} as const;

export async function GET(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const cursorParam = req.nextUrl.searchParams.get("cursor");
  const cursor = parseSyncCursor(cursorParam);
  if (cursorParam && !cursor) return invalidRequest("Invalid cursor");

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? MAX_LIMIT);
  const limit = Math.min(
    Math.max(1, Number.isNaN(limitParam) ? MAX_LIMIT : limitParam),
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

  const [accounts, events, tombstones] = await Promise.all([
    listCalendarAccountsForUser(auth.userId),
    db.calendarEvent.findMany({
      where: { userId: auth.userId, ...afterCursor },
      select: EVENT_SELECT,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    }),
    db.calendarTombstone.findMany({
      where: {
        userId: auth.userId,
        ...(cursor ? { deletedAt: { gt: cursor.at } } : {}),
      },
      select: { eventId: true, providerEventId: true },
    }),
  ]);

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  let nextCursor = cursorParam ?? formatSyncCursor(new Date(0), "");
  if (page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = formatSyncCursor(last.updatedAt, last.id);
  }

  return NextResponse.json({
    accounts: accounts.map(serializeCalendarAccount),
    events: page.map(serializeSyncEvent),
    tombstones,
    nextCursor,
    hasMore,
  });
}
