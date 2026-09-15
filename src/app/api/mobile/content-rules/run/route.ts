import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import {
  rateLimitContentRules,
  rateLimitUser,
  tooManyRequests,
} from "@/lib/rate-limit";
import { kickContentRuleEvaluation } from "@/lib/mail/content-rule-store";

/**
 * POST /api/mobile/content-rules/run
 *
 * Same as the web "Check now" action: kick the coalesced background run,
 * bounded by rateLimitContentRules (10 / 10 minutes).
 */

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const userLimit = await rateLimitUser(userId);
  if (!userLimit.allowed) return tooManyRequests(userLimit.retryAfter);

  const checkLimit = await rateLimitContentRules(userId);
  if (!checkLimit.allowed) {
    return NextResponse.json(
      { error: "Too many checks. Try again in a few minutes." },
      { status: 429 },
    );
  }

  kickContentRuleEvaluation(userId);
  return NextResponse.json({ success: true });
}
