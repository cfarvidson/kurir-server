import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  addContentRuleSenderForUser,
  kickContentRuleEvaluation,
} from "@/lib/mail/content-rule-store";
import {
  contentRuleErrorResponse,
  getRuleForUser,
  senderSchema,
  serializeRule,
} from "../../serialize";

/**
 * POST /api/mobile/content-rules/:id/senders
 *   { scope, scopeValue, includeExisting } → { rule }
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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

  const parsed = senderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  try {
    await addContentRuleSenderForUser(userId, id, parsed.data);
    kickContentRuleEvaluation(userId);
    const rule = await getRuleForUser(userId, id);
    return NextResponse.json({ rule: rule ? serializeRule(rule) : null });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
