import { findPeople } from "@/lib/mail/people-search";

export interface ContactSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  category: "IMBOX" | "FEED" | "PAPER_TRAIL";
  domain: string;
  contactId: string | null;
}

/** People group in search: cap per the old contact-hit limit. */
export const SEARCH_PEOPLE_LIMIT = 5;

/**
 * People group of the main search (kurir-ios#103, ranked in #117): people
 * ordered by Rank whose name, address, domain or company starts with the
 * query. Answers from the first character; message hits need two.
 */
export async function searchContacts(
  userId: string,
  query: string,
  limit = SEARCH_PEOPLE_LIMIT,
): Promise<ContactSearchResult[]> {
  if (query.trim().length < 1) return [];
  const people = await findPeople(userId, query, limit);
  return people.map((p) => ({
    id: p.contactId ?? p.email,
    email: p.email,
    displayName: p.displayName,
    category: p.category ?? "IMBOX",
    domain: p.domain,
    contactId: p.contactId,
  }));
}
