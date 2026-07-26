import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  contactEmailLabelSchema,
  getContactForUser,
  removeContactEmailForUser,
  setContactEmailLabelForUser,
  setContactEmailPrimaryForUser,
} from "@/lib/mail/contacts";
import { serializeContact, contactErrorResponse } from "../../../serialize";

/**
 * Per-email mobile surface. Ownership is user-scoped (the cores verify the
 * email's contact belongs to the caller), mirroring the web actions.
 *
 * PATCH  → { contact }   { label? } relabel and/or { isPrimary: true } promote
 * DELETE → { contact }   remove (primary promotion mirrors the web action;
 *                        the web UI only offers removal on 2+ email contacts
 *                        and the iOS UI mirrors that guard client-side)
 */

type Params = { params: Promise<{ id: string; emailId: string }> };

const patchSchema = z
  .object({
    label: contactEmailLabelSchema.optional(),
    isPrimary: z.literal(true).optional(),
  })
  .refine((v) => v.label !== undefined || v.isPrimary !== undefined, {
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

  const { id, emailId } = await params;
  try {
    if (parsed.data.label !== undefined) {
      await setContactEmailLabelForUser(userId, emailId, parsed.data.label);
    }
    if (parsed.data.isPrimary) {
      await setContactEmailPrimaryForUser(userId, emailId);
    }
    const contact = await getContactForUser(userId, id);
    return NextResponse.json({ contact: contact && serializeContact(contact) });
  } catch (err) {
    return contactErrorResponse(err);
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

  const { id, emailId } = await params;
  try {
    await removeContactEmailForUser(userId, emailId);
    const contact = await getContactForUser(userId, id);
    return NextResponse.json({ contact: contact && serializeContact(contact) });
  } catch (err) {
    return contactErrorResponse(err);
  }
}
