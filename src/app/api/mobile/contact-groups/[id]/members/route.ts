import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { addGroupMemberForUser } from "@/lib/mail/contact-groups";
import { getGroupForUser, groupErrorResponse } from "../../serialize";

/**
 * POST → { group }   add a member ({ contactEmailId }; idempotent — adding
 * the same member twice is a no-op, not an error).
 */

const postSchema = z.object({ contactEmailId: z.string().trim().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  try {
    await addGroupMemberForUser(userId, id, parsed.data.contactEmailId);
    const group = await getGroupForUser(userId, id);
    return NextResponse.json({ group: group ?? null });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
