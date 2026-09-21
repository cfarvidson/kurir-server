import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import {
  rateLimitContentRules,
  rateLimitUser,
  tooManyRequests,
} from "@/lib/rate-limit";
import {
  kickContentRuleEvaluation,
  recheckContentRuleForUser,
} from "@/lib/mail/content-rule-store";
import {
  contentRuleErrorResponse,
  getRuleForUser,
  serializeRule,
} from "../../serialize";

/**
 * POST /api/mobile/content-rules/:id/recheck → { rule }
 *
 * Same as the web "Re-check last 30 days": judge the rule's mail from the
 * last 30 days again and kick a run, bounded like Check now.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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

  const { id } = await params;
  try {
    await recheckContentRuleForUser(userId, id);
    kickContentRuleEvaluation(userId);
    const rule = await getRuleForUser(userId, id);
    return NextResponse.json({ rule: rule ? serializeRule(rule) : null });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
