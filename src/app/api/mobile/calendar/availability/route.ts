import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { availabilitySchema } from "@/lib/calendar/availability";
import {
  invalidRequest,
  readJsonBody,
  requireCalendarMobileAuth,
} from "@/lib/calendar/mobile";

/**
 * PUT /api/mobile/calendar/availability
 *
 * Body: { days: [{ on, start, end }] x 7 }, Monday first, minutes after
 * midnight on 30-minute steps. Replaces the whole setting and echoes it
 * back; the next calendar sync carries the same value to every device.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireCalendarMobileAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if ("error" in body) return body.error;

  const parsed = availabilitySchema.safeParse(body.data);
  if (!parsed.success) return invalidRequest();

  await db.user.update({
    where: { id: auth.userId },
    data: { calendarAvailability: parsed.data },
  });

  return NextResponse.json({ availability: parsed.data });
}
