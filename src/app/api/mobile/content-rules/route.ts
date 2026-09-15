import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  createContentRuleForUser,
  kickContentRuleEvaluation,
  listContentRulesForUser,
} from "@/lib/mail/content-rule-store";
import {
  contentRuleErrorResponse,
  createRuleSchema,
  getRuleForUser,
  serializeRule,
} from "./serialize";

/**
 * Mobile surface for AI content rules, wrapping the same store cores as
 * the web /filters page. Judging stays on the server; this only manages
 * rules and kicks a run.
 *
 * GET  → { rules }
 * POST → { rule }   create with the first sender
 */

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const rules = await listContentRulesForUser(userId);
  return NextResponse.json({ rules: rules.map(serializeRule) });
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

  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const created = await createContentRuleForUser(userId, parsed.data);
    kickContentRuleEvaluation(userId);
    const rule = await getRuleForUser(userId, created.id);
    return NextResponse.json({
      rule: rule ? serializeRule(rule) : { id: created.id },
    });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
