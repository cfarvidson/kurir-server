import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  addContactEmailForUser,
  contactEmailLabelSchema,
  getContactForUser,
} from "@/lib/mail/contacts";
import { serializeContact, contactErrorResponse } from "../../serialize";

/**
 * POST → { contact }   add an email to a contact ({ email, label? }).
 * Mirrors the web action exactly: duplicate guard across all of the user's
 * contacts, first email becomes primary, approved-sender auto-link.
 */

const postSchema = z.object({
  email: z.string().trim().min(1),
  label: contactEmailLabelSchema.optional(),
});

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
    await addContactEmailForUser(
      userId,
      id,
      parsed.data.email,
      parsed.data.label ?? "personal",
    );
    const contact = await getContactForUser(userId, id);
    return NextResponse.json({ contact: contact && serializeContact(contact) });
  } catch (err) {
    return contactErrorResponse(err);
  }
}
