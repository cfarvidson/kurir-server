import { NextRequest, NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/mobile/auth";
import { findPeople } from "@/lib/mail/people-search";

/** Suggestions per request (compose dropdown, contact link dialog). */
export const CONTACT_SUGGESTION_LIMIT = 8;

/**
 * GET /api/contacts/search?q=<text>
 *
 * Recipient autosuggest (kurir-ios#117): Contact records merged with every
 * address the user has exchanged mail with (From/To/Cc/Bcc, from the
 * materialised Rank), ordered by Rank, own addresses excluded. A query
 * without "@" that starts a domain label or a signature company returns
 * the top people at that domain with `domainHint` set ("at tv4.se").
 * Session cookie (web) or bearer token (mobile).
 */
export async function GET(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 1) {
    return NextResponse.json([]);
  }

  const people = await findPeople(userId, q, CONTACT_SUGGESTION_LIMIT);
  return NextResponse.json(
    people.map((p) => ({
      // Contact ids link/merge in the contact UI; the `sender-` prefix marks
      // mail-derived people it must skip.
      id: p.contactId ?? `sender-${p.email}`,
      name: p.displayName || p.email,
      email: p.email,
      displayName: p.displayName ?? p.email,
      emails: p.emails.map((email, i) => ({
        email,
        label: "personal",
        isPrimary: i === 0,
      })),
      domainHint: p.domainHint,
      score: p.score,
    })),
  );
}
