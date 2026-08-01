import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { removeGroupMemberForUser } from "@/lib/mail/contact-groups";
import { getGroupForUser, groupErrorResponse } from "../../../serialize";

/**
 * DELETE → { group }   remove a member.
 */

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const { id, memberId } = await params;
  try {
    await removeGroupMemberForUser(userId, memberId);
    const group = await getGroupForUser(userId, id);
    return NextResponse.json({ group: group ?? null });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
