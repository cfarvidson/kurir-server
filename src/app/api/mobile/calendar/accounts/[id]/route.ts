import { NextRequest, NextResponse } from "next/server";
import { deleteCalendarAccount } from "@/lib/calendar/accounts";
import {
  calendarRouteError,
  requireCalendarMobileAuth,
} from "@/lib/calendar/mobile";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/mobile/calendar/accounts/:id
 *
 * Disconnect. Tombstones remaining masters then unschedules sync.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await deleteCalendarAccount(auth.userId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return calendarRouteError(err);
  }
}
