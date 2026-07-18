import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMobileAuth } from "@/lib/mobile/auth";

/**
 * POST /api/mobile/push/subscribe   { deviceToken } — register APNs token
 * DELETE /api/mobile/push/subscribe { deviceToken } — remove it
 *
 * iOS rows reuse the PushSubscription table: platform "ios", endpoint
 * "apns:<token>", empty web-push keys.
 */

const tokenSchema = z.object({
  deviceToken: z
    .string()
    .min(16)
    .max(200)
    .regex(/^[0-9a-fA-F]+$/, "APNs device tokens are hex strings"),
});

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device token" }, { status: 400 });
  }

  const endpoint = `apns:${parsed.data.deviceToken.toLowerCase()}`;

  // A device token that changes hands (new login on the same device) moves
  // to the new user rather than conflicting.
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      platform: "ios",
      p256dh: "",
      auth: "",
      userId: mobileAuth.userId,
    },
    update: { userId: mobileAuth.userId },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device token" }, { status: 400 });
  }

  await db.pushSubscription.deleteMany({
    where: {
      endpoint: `apns:${parsed.data.deviceToken.toLowerCase()}`,
      userId: mobileAuth.userId,
    },
  });

  return NextResponse.json({ success: true });
}
