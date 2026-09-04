import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkNewMailForUser } from "@/lib/mail/check-new-mail";
import { tooManyRequests } from "@/lib/rate-limit";

/**
 * POST /api/mail/check
 *
 * Cookie-authenticated cheap IMAP new-mail check. Not a full mailbox sync.
 */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await checkNewMailForUser(userId);
  if (result.status === "rate_limited") {
    return tooManyRequests(result.retryAfter);
  }
  return NextResponse.json({ success: true, ingested: result.ingested });
}
