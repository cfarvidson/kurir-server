import { NextRequest, NextResponse } from "next/server";
import { deleteEventForUser, updateEventForUser } from "@/lib/calendar/write";
import {
  calendarRouteError,
  invalidRequest,
  parseOccurrence,
  parseRecurrenceRange,
  readJsonBody,
  requireCalendarMobileAuth,
  updateEventBodySchema,
} from "@/lib/calendar/mobile";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/mobile/calendar/events/:id
 *
 * Body: EventInput + range + optional occurrence (+ optional calendarId to
 * move). `occurrence` names which instance `this` and `thisAndFollowing`
 * apply to; omitted, it falls back to the series start.
 *
 * DELETE /api/mobile/calendar/events/:id?range=&occurrence=
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = updateEventBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  const { id } = await params;
  const { range, occurrence, ...input } = parsed.data;
  try {
    await updateEventForUser(auth.userId, id, input, range, occurrence);
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
  const occurrence = parseOccurrence(
    req.nextUrl.searchParams.get("occurrence"),
  );

  const { id } = await params;
  try {
    await deleteEventForUser(auth.userId, id, range, occurrence);
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}
