import { NextRequest, NextResponse } from "next/server";
import { rateLimitDraftGeneration, tooManyRequests } from "@/lib/rate-limit";
import { requireMobileAuth } from "@/lib/mobile/auth";
import {
  generateDraftForUser,
  generateDraftSchema,
} from "@/lib/draft-generation/generate";
import {
  DraftGenerationError,
  httpStatusForDraftGenerationError,
} from "@/lib/draft-generation/types";

/**
 * POST → { draft } | { body, subject? }
 *
 * Without an `instruction` field this is the old contract: a body is
 * generated from the mail context and upserted as the normal Draft row.
 * With one (the compose assistant, #133) the body comes back instead and
 * the Draft row is untouched — the composer owns the versions. A client
 * that asked for a body and got `{ draft }` is talking to an old server.
 *
 * Errors carry `{ error, code }`: 400 no correspondent / forward, 403 demo,
 * 409 body exists and replace is false, 422 token missing / dead / usage
 * limited. Rate limited tighter than ordinary mobile CRUD.
 */

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitDraftGeneration(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = generateDraftSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await generateDraftForUser(userId, parsed.data);
    if (result.mode === "panel") {
      return NextResponse.json({
        body: result.body,
        ...(result.subject ? { subject: result.subject } : {}),
      });
    }
    return NextResponse.json({ draft: result.draft });
  } catch (error) {
    if (error instanceof DraftGenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: httpStatusForDraftGenerationError(error.code) },
      );
    }
    throw error;
  }
}
