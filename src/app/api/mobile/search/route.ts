import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { searchMessages } from "@/lib/mail/search";
import { MESSAGE_SELECT } from "@/lib/mobile/message-select";

/**
 * GET /api/mobile/search?q=<query>&limit=50
 *
 * Full-text search across all of the user's mail, delegating to the same
 * FTS query as the web client. Returns full sync-shaped message metadata
 * so the app can upsert hits that aren't in its local store yet.
 */

const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limitCheck = await rateLimitUser(userId);
  if (!limitCheck.allowed) return tooManyRequests(limitCheck.retryAfter);

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? MAX_LIMIT);
  const limit = Math.min(
    Math.max(1, isNaN(limitParam) ? MAX_LIMIT : limitParam),
    MAX_LIMIT,
  );

  const hits = await searchMessages(userId, q, Prisma.empty, limit);
  if (hits.length === 0) {
    return NextResponse.json({ messages: [] });
  }

  // Re-fetch the hits with the sync shape, preserving FTS rank order.
  const rows = await db.message.findMany({
    where: { userId, id: { in: hits.map((h) => h.id) } },
    select: MESSAGE_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const messages = hits.flatMap((hit) => byId.get(hit.id) ?? []);

  return NextResponse.json({ messages });
}
