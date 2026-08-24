import { NextRequest, NextResponse } from "next/server";
import { createIcsAccount } from "@/lib/calendar/ics-account";
import {
  icsBodySchema,
  calendarRouteError,
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
} from "@/lib/calendar/mobile";

/**
 * POST /api/mobile/calendar/accounts/ics
 *
 * Body: { url }. Fetches the public ICS feed and upserts a read-only
 * CalendarAccount. Native never fetches the URL itself.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = icsBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  try {
    const account = await createIcsAccount({
      userId: auth.userId,
      url: parsed.data.url,
    });
    return NextResponse.json({ id: account.id });
  } catch (err) {
    return calendarRouteError(err);
  }
}
