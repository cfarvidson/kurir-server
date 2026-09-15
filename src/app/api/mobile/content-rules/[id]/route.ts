import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  deleteContentRuleForUser,
  kickContentRuleEvaluation,
  updateContentRuleForUser,
} from "@/lib/mail/content-rule-store";
import {
  contentRuleErrorResponse,
  getRuleForUser,
  patchRuleSchema,
  serializeRule,
} from "../serialize";

/**
 * PATCH  → { rule }   criterion / actions / optional recheck
 * DELETE → { success: true }
 */

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const parsed = patchRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const { rejudge } = await updateContentRuleForUser(userId, id, parsed.data);
    if (rejudge) kickContentRuleEvaluation(userId);
    const rule = await getRuleForUser(userId, id);
    return NextResponse.json({ rule: rule ? serializeRule(rule) : null });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  try {
    await deleteContentRuleForUser(userId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
