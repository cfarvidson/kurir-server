import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  createScheduledSchema,
  createScheduledMessageForUser,
  listScheduledForUser,
  type CreateScheduledInput,
} from "@/lib/mail/scheduled-messages";

/**
 * Mobile surface for scheduled sends, sharing the create-core (and its 1–14
 * minute jitter, encryption and ownership checks) with the web composer so a
 * message scheduled on either surface is an identical row.
 *
 * GET  → { scheduled: [{ id, to, cc, subject, scheduledFor, status, error }] }
 * POST → { id, scheduledFor }   create one (shared zod schema; future-dated)
 *
 * The list is fetched on demand (low frequency, always-fresh status) and is not
 * mirrored into the mobile GRDB store.
 */

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const scheduled = await listScheduledForUser(userId);
  return NextResponse.json({ scheduled });
}

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  // The shared schema's `scheduledFor` transform throws on a past date (so the
  // web action rejects too); safeParse re-throws that, so validate inside a
  // try and treat any failure as a 400 rather than a 500.
  try {
    const parsed = createScheduledSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { id, scheduledFor } = await createScheduledMessageForUser(
      userId,
      body as CreateScheduledInput,
    );
    return NextResponse.json({ id, scheduledFor });
  } catch (err) {
    // Ownership violations (connection / attachments) surface as 400.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 },
    );
  }
}
