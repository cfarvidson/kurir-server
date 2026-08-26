import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  getDraftGenerationStatus,
  removeDraftGenerationCredential,
  saveDraftGenerationCredential,
} from "@/lib/draft-generation/credential";
import {
  DraftGenerationError,
  httpStatusForDraftGenerationError,
} from "@/lib/draft-generation/types";

/**
 * Mobile credential surface for draft generation. The secret is write-only:
 * GET reports `{ connected, provider }` and never includes a token field.
 *
 * GET    → { connected, provider }
 * PUT    → { connected, provider }   store a classified, encrypted credential
 * DELETE → { connected: false, provider: null }
 */

const putSchema = z.object({
  provider: z.enum(["claudeCode", "grokBuild"]),
  token: z.string(),
});

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  return NextResponse.json(await getDraftGenerationStatus(userId));
}

export async function PUT(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = putSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const status = await saveDraftGenerationCredential(
      userId,
      parsed.data.provider,
      parsed.data.token,
    );
    return NextResponse.json(status);
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

export async function DELETE(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  return NextResponse.json(await removeDraftGenerationCredential(userId));
}
