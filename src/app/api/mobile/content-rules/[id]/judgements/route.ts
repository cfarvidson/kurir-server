import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { listContentRuleJudgementsForUser } from "@/lib/mail/content-rule-store";
import { contentRuleErrorResponse } from "../../serialize";

/**
 * GET /api/mobile/content-rules/:id/judgements?limit=&cursor=
 *
 * Every message the rule has judged, newest first, misses included — the
 * mail behind the rule's counter and what the model ruled for each one.
 * `nextCursor` is null on the last page.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  const search = req.nextUrl.searchParams;
  const rawLimit = Number(search.get("limit"));

  try {
    const page = await listContentRuleJudgementsForUser(userId, id, {
      limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
      cursor: search.get("cursor") ?? undefined,
    });
    return NextResponse.json({
      judgedCount: page.judgedCount,
      matchedCount: page.matchedCount,
      nextCursor: page.nextCursor,
      judgements: page.judgements.map((judgement) => ({
        id: judgement.id,
        matched: judgement.matched,
        reason: judgement.reason,
        appliedAction: judgement.appliedAction,
        createdAt: judgement.createdAt,
        messageId: judgement.message.id,
        subject: judgement.message.subject,
        fromAddress: judgement.message.fromAddress,
        fromName: judgement.message.fromName,
        receivedAt: judgement.message.receivedAt,
      })),
    });
  } catch (err) {
    return contentRuleErrorResponse(err);
  }
}
