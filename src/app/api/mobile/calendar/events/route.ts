import { NextRequest, NextResponse } from "next/server";
import { createEventForUser } from "@/lib/calendar/write";
import {
  calendarRouteError,
  createEventBodySchema,
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
} from "@/lib/calendar/mobile";

/**
 * POST /api/mobile/calendar/events
 *
 * Body: EventInput + calendarId.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = createEventBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  const { calendarId, ...input } = parsed.data;
  try {
    const created = await createEventForUser(auth.userId, calendarId, input);
    return NextResponse.json({ id: created.id });
  } catch (err) {
    return calendarRouteError(err);
  }
}
