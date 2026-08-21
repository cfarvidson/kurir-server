import { NextRequest, NextResponse } from "next/server";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import {
  invalidRequest,
  parseCalendarIds,
  parseIsoRange,
  requireCalendarMobileAuth,
  serializeRangeInstance,
} from "@/lib/calendar/mobile";

/**
 * GET /api/mobile/calendar/range?start&end&calendarIds?
 *
 * Server-expanded visible instances for the ISO window. Optional
 * comma-separated calendarIds filters the result.
 */
export async function GET(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const range = parseIsoRange(
    req.nextUrl.searchParams.get("start"),
    req.nextUrl.searchParams.get("end"),
  );
  if (!range) return invalidRequest("Invalid range");

  const calendarIds = parseCalendarIds(
    req.nextUrl.searchParams.get("calendarIds"),
  );
  const rows = await listVisibleInstancesForUser(
    auth.userId,
    range.start,
    range.end,
  );
  const filtered = calendarIds
    ? rows.filter((row) => calendarIds.includes(row.calendarId))
    : rows;

  return NextResponse.json({
    instances: filtered.map(serializeRangeInstance),
  });
}
