import { NextRequest, NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/mobile/auth";
import { isDemoInstance } from "@/lib/demo";
import {
  SendMailError,
  sendMailForUser,
  sendMailSchema,
} from "@/lib/mail/send";
import { rateLimitSend, tooManyRequests } from "@/lib/rate-limit";
import { z } from "zod";

export async function POST(request: NextRequest) {
  // Session cookie (web) or bearer token (mobile)
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitSend(userId);
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfter);
  }

  // Demo instances have fictional SMTP hosts — fail fast with a clear
  // message instead of a connection error.
  if (isDemoInstance()) {
    return NextResponse.json(
      { error: "Sending is disabled on this demo instance." },
      { status: 400 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = sendMailSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await sendMailForUser(userId, parsed.data);
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    if (error instanceof SendMailError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to send email:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send email",
      },
      { status: 500 },
    );
  }
}
