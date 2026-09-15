import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { removeContentRuleSenderForUser } from "@/lib/mail/content-rule-store";
import {
  contentRuleErrorResponse,
  getRuleForUser,
  serializeRule,
} from "../../../serialize";

/**
 * DELETE /api/mobile/content-rules/:id/senders/:senderId → { rule }
 */

type Params = { params: Promise<{ id: string; senderId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { id, senderId } = await params;
  try {
    await removeContentRuleSenderForUser(userId, senderId);
    const rule = await getRuleForUser(userId, id);
    return NextResponse.json({ rule: rule ? serializeRule(rule) : null });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
