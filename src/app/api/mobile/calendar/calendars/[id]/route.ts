import { NextRequest, NextResponse } from "next/server";
import { setCalendarVisibleForUser } from "@/lib/calendar/accounts";
import {
  calendarRouteError,
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
  visibilityBodySchema,
} from "@/lib/calendar/mobile";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/mobile/calendar/calendars/:id
 *
 * Body: { isVisible }.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = visibilityBodySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  const { id } = await params;
  try {
    await setCalendarVisibleForUser(auth.userId, id, parsed.data.isVisible);
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}
