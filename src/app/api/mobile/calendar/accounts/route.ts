import { NextRequest, NextResponse } from "next/server";
import { listCalendarAccountsForUser } from "@/lib/calendar/accounts";
import {
  requireCalendarMobileAuth,
  serializeCalendarAccount,
} from "@/lib/calendar/mobile";

/**
 * GET /api/mobile/calendar/accounts
 *
 * Accounts plus nested calendars (visibility, color, read-only). Same
 * shape the native client upserts from GET /sync.
 */
export async function GET(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const rows = await listCalendarAccountsForUser(auth.userId);
  return NextResponse.json({
    accounts: rows.map(serializeCalendarAccount),
  });
}
