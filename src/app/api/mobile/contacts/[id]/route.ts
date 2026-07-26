import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  deleteContactForUser,
  getContactForUser,
  renameContactForUser,
} from "@/lib/mail/contacts";
import { serializeContact, contactErrorResponse } from "../serialize";

/**
 * Per-contact mobile surface.
 *
 * GET    → { contact }   detail (404 if not owned)
 * PATCH  → { contact }   rename ({ name }; notes is web-invisible, so no
 *                        notes editing on mobile either)
 * DELETE → { success: true }
 */

type Params = { params: Promise<{ id: string }> };

async function authAndLimit(
  req: NextRequest,
): Promise<{ response: NextResponse; userId?: never } | { userId: string }> {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const limit = await rateLimitUser(mobileAuth.userId);
  if (!limit.allowed) return { response: tooManyRequests(limit.retryAfter) };
  return { userId: mobileAuth.userId };
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authAndLimit(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const contact = await getContactForUser(auth.userId, id);
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json({ contact: serializeContact(contact) });
}

const patchSchema = z.object({ name: z.string().trim().min(1) });

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authAndLimit(req);
  if ("response" in auth) return auth.response;

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
    await renameContactForUser(auth.userId, id, parsed.data.name);
    const contact = await getContactForUser(auth.userId, id);
    return NextResponse.json({ contact: contact && serializeContact(contact) });
  } catch (err) {
    return contactErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authAndLimit(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    await deleteContactForUser(auth.userId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return contactErrorResponse(err);
  }
}
