import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  createContactSchema,
  createContactForUser,
  getContactForUser,
  listContactsForUser,
} from "@/lib/mail/contacts";
import { serializeContact, contactErrorResponse } from "./serialize";

/**
 * Mobile surface for the contact list, sharing the cores in
 * `@/lib/mail/contacts` with the web server actions so both surfaces behave
 * identically. Search stays on `/api/contacts/search` (already bearer-aware
 * via getRequestUserId); this list powers the browsable A–Ö view.
 *
 * GET  → { contacts: [{ id, name, emails: [{ id, email, label, isPrimary }] }] }
 * POST → { contact }   create one (shared zod schema; label enum enforced here)
 */

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const contacts = await listContactsForUser(userId);
  return NextResponse.json({ contacts: contacts.map(serializeContact) });
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

  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const contactId = await createContactForUser(userId, parsed.data);
    const contact = await getContactForUser(userId, contactId);
    return NextResponse.json({ contact: contact && serializeContact(contact) });
  } catch (err) {
    return contactErrorResponse(err);
  }
}
