import { NextRequest, NextResponse } from "next/server";
import { rsvpToMeetingForUser } from "@/lib/calendar/rsvp";
import {
  calendarRouteError,
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
  rsvpBodySchema,
} from "@/lib/calendar/mobile";

/**
 * POST /api/mobile/calendar/rsvp
 *
 * Body: { messageId, status, calendarId? }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = rsvpBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  try {
    await rsvpToMeetingForUser(
      auth.userId,
      parsed.data.messageId,
      parsed.data.status,
      parsed.data.calendarId,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}
