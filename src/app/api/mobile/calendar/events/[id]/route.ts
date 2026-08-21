import { NextRequest, NextResponse } from "next/server";
import { deleteEventForUser, updateEventForUser } from "@/lib/calendar/write";
import {
  calendarRouteError,
  invalidRequest,
  parseRecurrenceRange,
  readJsonBody,
  requireCalendarMobileAuth,
  updateEventBodySchema,
} from "@/lib/calendar/mobile";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/mobile/calendar/events/:id
 *
 * Body: EventInput + range (+ optional calendarId to move).
 *
 * DELETE /api/mobile/calendar/events/:id?range=
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = updateEventBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  const { id } = await params;
  const { range, ...input } = parsed.data;
  try {
    await updateEventForUser(auth.userId, id, input, range);
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const range = parseRecurrenceRange(req.nextUrl.searchParams.get("range"));
  if (!range) return invalidRequest("Invalid range");

  const { id } = await params;
  try {
    await deleteEventForUser(auth.userId, id, range);
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}
