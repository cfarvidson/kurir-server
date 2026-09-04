import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { checkNewMailForUser } from "@/lib/mail/check-new-mail";
import { tooManyRequests } from "@/lib/rate-limit";

/**
 * POST /api/mobile/check
 *
 * Bearer-authenticated cheap IMAP new-mail check. Same ingest as
 * POST /api/mail/check. Not a full mailbox sync.
 */
export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await checkNewMailForUser(mobileAuth.userId);
  if (result.status === "rate_limited") {
    return tooManyRequests(result.retryAfter);
  }
  return NextResponse.json({ success: true, ingested: result.ingested });
}
