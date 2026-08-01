import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  deleteGroupForUser,
  groupTargetSchema,
  renameGroupForUser,
  setGroupDefaultTargetForUser,
} from "@/lib/mail/contact-groups";
import { getGroupForUser, groupErrorResponse } from "../serialize";

/**
 * Per-group mobile surface.
 *
 * PATCH  → { group }   { name?, defaultTarget? } (at least one field; maps
 *                       to the rename / setDefaultTarget cores)
 * DELETE → { success: true }   (members cascade-delete)
 */

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    defaultTarget: groupTargetSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.defaultTarget !== undefined, {
    message: "Nothing to update",
  });

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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;
  try {
    if (parsed.data.name !== undefined) {
      await renameGroupForUser(userId, id, parsed.data.name);
    }
    if (parsed.data.defaultTarget !== undefined) {
      await setGroupDefaultTargetForUser(userId, id, parsed.data.defaultTarget);
    }
    const group = await getGroupForUser(userId, id);
    return NextResponse.json({ group: group ?? null });
  } catch (err) {
    return groupErrorResponse(err);
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
    await deleteGroupForUser(userId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
