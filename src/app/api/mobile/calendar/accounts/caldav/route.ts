import { NextRequest, NextResponse } from "next/server";
import { createCalDavAccount } from "@/lib/calendar/accounts";
import {
  caldavBodySchema,
  calendarRouteError,
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
} from "@/lib/calendar/mobile";

/**
 * POST /api/mobile/calendar/accounts/caldav
 *
 * Body: { url, username, password }. Discovers calendar-home then
 * upserts a CalDAV CalendarAccount.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = caldavBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  try {
    const account = await createCalDavAccount({
      userId: auth.userId,
      url: parsed.data.url,
      username: parsed.data.username,
      password: parsed.data.password,
    });
    return NextResponse.json({ id: account.id });
  } catch (err) {
    return calendarRouteError(err);
  }
}
