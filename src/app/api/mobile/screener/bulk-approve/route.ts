import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { bulkApproveOldSendersForUser } from "@/lib/mail/mutations";

/**
 * POST /api/mobile/screener/bulk-approve   { days?: number }
 *
 * Auto-approve all PENDING senders whose most recent message is older than
 * `days` days (default 90) into IMBOX. Returns { approved: number }.
 *
 * Unlike /api/mobile/actions, this is NOT an offline-queue action: it returns a
 * count and is not idempotent per entity, so it lives on its own endpoint.
 */

const bodySchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const approved = await bulkApproveOldSendersForUser(
    userId,
    parsed.data.days ?? 90,
  );

  return NextResponse.json({ approved });
}
