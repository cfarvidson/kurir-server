import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/setup/check
 *
 * Returns whether the instance needs first-run setup (no users exist).
 * No authentication required — used by login page to redirect to setup.
 */
export async function GET() {
  const userCount = await db.user.count({ take: 1 });

  return NextResponse.json(
    { needsSetup: userCount === 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
