import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import { parseInstancesRange } from "@/lib/calendar/instances-route";
import { serializeInstance } from "@/lib/calendar/page-data";
import { rangeUtc } from "@/lib/calendar/view-time";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = parseInstancesRange(params.get("start"), params.get("end"));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { timezone: true },
  });
  const timezone = user?.timezone || "UTC";
  const { from, to } = rangeUtc(parsed.start, parsed.endExclusive, timezone);
  const instances = await listVisibleInstancesForUser(
    session.user.id,
    from,
    to,
  );

  return NextResponse.json({ instances: instances.map(serializeInstance) });
}
