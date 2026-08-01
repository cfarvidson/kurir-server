import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  createGroupForUser,
  groupTargetSchema,
  listGroupsForUser,
} from "@/lib/mail/contact-groups";
import { getGroupForUser, groupErrorResponse } from "./serialize";

/**
 * Mobile surface for contact groups, sharing the cores in
 * `@/lib/mail/contact-groups` with the web server actions so both surfaces
 * behave identically.
 *
 * GET  → { groups: [{ id, name, defaultTarget, members: [{ memberId,
 *          contactEmailId, email, name }] }] }   (sorted by name)
 * POST → { group }   create ({ name, defaultTarget?, memberContactEmailIds? })
 */

const createGroupSchema = z.object({
  name: z.string().trim().min(1),
  defaultTarget: groupTargetSchema.optional(),
  memberContactEmailIds: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const groups = await listGroupsForUser(userId);
  return NextResponse.json({ groups });
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

  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const groupId = await createGroupForUser(userId, parsed.data);
    const group = await getGroupForUser(userId, groupId);
    return NextResponse.json({ group: group ?? null });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
