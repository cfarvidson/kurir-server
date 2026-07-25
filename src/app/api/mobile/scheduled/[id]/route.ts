import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  cancelScheduledForUser,
  sendScheduledNowForUser,
} from "@/lib/mail/scheduled-messages";

/**
 * Per-message mobile actions for a scheduled send.
 *
 * DELETE → { success: true }   cancel (404 if not owned, 409 if not PENDING)
 * POST { action: "sendNow" } → { success: true }   deliver it now
 */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  const result = await cancelScheduledForUser(userId, id);
  if (result === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result === "not_pending") {
    return NextResponse.json(
      { error: "Only pending messages can be cancelled" },
      { status: 409 },
    );
  }
  return NextResponse.json({ success: true });
}

const postSchema = z.object({ action: z.literal("sendNow") });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  try {
    await sendScheduledNowForUser(userId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Lost the race to the background scheduler (already claimed/sent).
    if (message.includes("no longer PENDING")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
