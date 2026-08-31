import { db } from "@/lib/db";
import type { SenderCategory } from "@prisma/client";
import { getOwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";

/**
 * Rank-ordered people matching (kurir-ios#117), shared by the People group
 * in search and by compose autosuggest (`/api/contacts/search`). Mirrored
 * by `SearchPeople.swift`; both are pinned to the fixture's
 * `expectedPeopleSearch` and `expectedDomainTypeahead`.
 *
 * A person matches when the query is a prefix of
 * - a whitespace-separated token of the display name (first or last name),
 * - the address local part or the whole address ("ann", "anna@ac"),
 * - a label of the domain ("tv4" for tv4.se or mail.tv4.se), or
 * - a token of the company from their signature.
 *
 * Substring matches ("erg" for Berg) do not count: Xobni's first letter
 * surfaced the right person because it ranked prefix hits, not any hit.
 * Results are ordered by Rank score desc, then name, then address.
 */

export type PersonMatch = "name" | "address" | "domain" | "company";

export interface PersonCandidate {
  email: string;
  displayName: string | null;
  domain: string;
  score: number;
  company?: string | null;
}

export interface PeopleHit {
  email: string;
  displayName: string | null;
  domain: string;
  score: number;
  matchedBy: PersonMatch;
  /** The domain to show ("at tv4.se") when the query hit the domain or company, not the person. */
  domainHint: string | null;
  contactId: string | null;
  /** Every address of the contact (compose lists them); the person's own for others. */
  emails: string[];
  category: SenderCategory | null;
}

function needleOf(query: string): string {
  return query.trim().toLowerCase();
}

/** Does any whitespace-separated token of `text` start with `needle`? */
export function tokenPrefix(text: string | null | undefined, needle: string): boolean {
  if (!text || !needle) return false;
  return text
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token.length > 0 && token.startsWith(needle));
}

/** Does any dot-separated label of `domain` start with `needle`? */
export function domainLabelPrefix(domain: string, needle: string): boolean {
  if (!domain || !needle) return false;
  const lower = domain.toLowerCase();
  return (
    lower.startsWith(needle) ||
    lower.split(".").some((label) => label.length > 0 && label.startsWith(needle))
  );
}

export function matchPerson(
  person: PersonCandidate,
  query: string,
): PersonMatch | null {
  const needle = needleOf(query);
  if (!needle) return null;
  if (tokenPrefix(person.displayName, needle)) return "name";
  const email = person.email.toLowerCase();
  if (email.startsWith(needle)) return "address";
  const domain = person.domain || email.split("@")[1] || "";
  if (domainLabelPrefix(domain, needle)) return "domain";
  if (tokenPrefix(person.company, needle)) return "company";
  return null;
}

export function comparePeople(
  a: { score: number; displayName: string | null; email: string },
  b: { score: number; displayName: string | null; email: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const an = (a.displayName || a.email).localeCompare(b.displayName || b.email, undefined, {
    sensitivity: "base",
  });
  return an || a.email.localeCompare(b.email);
}

/** Pure ranking: the candidates that match, best Rank first, capped. */
export function rankedPeople<T extends PersonCandidate>(
  people: T[],
  query: string,
  limit: number,
): (T & { matchedBy: PersonMatch; domainHint: string | null })[] {
  const hits: (T & { matchedBy: PersonMatch; domainHint: string | null })[] = [];
  for (const person of people) {
    const matchedBy = matchPerson(person, query);
    if (!matchedBy) continue;
    hits.push({
      ...person,
      matchedBy,
      domainHint:
        matchedBy === "domain" || matchedBy === "company"
          ? person.domain || person.email.split("@")[1] || null
          : null,
    });
  }
  return hits.sort(comparePeople).slice(0, limit);
}

/** Prisma filter for the prefix rules on a PersonRank row. */
export function personPrefixWhere(query: string) {
  const q = needleOf(query);
  const insensitive = "insensitive" as const;
  return [
    { displayName: { startsWith: q, mode: insensitive } },
    { displayName: { contains: ` ${q}`, mode: insensitive } },
    { email: { startsWith: q } },
    { domain: { startsWith: q } },
    { domain: { contains: `.${q}` } },
  ];
}

/** Prisma filter for company typeahead on Sender.signatureCompany. */
export function companyPrefixWhere(query: string) {
  const q = needleOf(query);
  const insensitive = "insensitive" as const;
  return [
    { signatureCompany: { startsWith: q, mode: insensitive } },
    { signatureCompany: { contains: ` ${q}`, mode: insensitive } },
  ];
}

const CANDIDATE_TAKE = 40;

/**
 * Rank-ordered people for `query` from the materialised Rank and the
 * Contact records, own addresses excluded, senders the user has rejected
 * or not yet screened left out unless a Contact holds the address.
 * Contacts contribute one row (their best-ranked matching address, every
 * address listed) and their name wins.
 */
export async function findPeople(
  userId: string,
  query: string,
  limit: number,
): Promise<PeopleHit[]> {
  const q = needleOf(query);
  if (!q) return [];

  const [own, ranked, contacts, companyDomains] = await Promise.all([
    getOwnAddresses(userId),
    db.personRank.findMany({
      where: { userId, OR: personPrefixWhere(q) },
      select: { email: true, displayName: true, domain: true, score: true },
      orderBy: [{ score: "desc" }, { email: "asc" }],
      take: CANDIDATE_TAKE,
    }),
    db.contact.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        emails: {
          select: { email: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      take: 20,
    }),
    q.includes("@")
      ? Promise.resolve([] as { domain: string; signatureCompany: string | null }[])
      : db.sender.findMany({
          where: { userId, OR: companyPrefixWhere(q) },
          select: { domain: true, signatureCompany: true },
          distinct: ["domain"],
          take: 5,
        }),
  ]);

  // Company typeahead: the domains whose senders' signatures name a company
  // starting with the query, and the people on them.
  const companyByDomain = new Map<string, string>();
  for (const d of companyDomains) {
    if (d.signatureCompany) companyByDomain.set(d.domain.toLowerCase(), d.signatureCompany);
  }
  const companyPeople =
    companyByDomain.size > 0
      ? await db.personRank.findMany({
          where: { userId, domain: { in: [...companyByDomain.keys()] } },
          select: { email: true, displayName: true, domain: true, score: true },
          orderBy: [{ score: "desc" }, { email: "asc" }],
          take: CANDIDATE_TAKE,
        })
      : [];

  // Candidates keyed by address: ranked rows first, then contacts' addresses.
  type Candidate = PersonCandidate & { contactId: string | null; emails: string[] };
  const byEmail = new Map<string, Candidate>();
  for (const row of [...ranked, ...companyPeople]) {
    const email = row.email.toLowerCase();
    if (byEmail.has(email) || isOwnAddress(email, own)) continue;
    byEmail.set(email, {
      email,
      displayName: row.displayName,
      domain: row.domain,
      score: row.score,
      company: companyByDomain.get(row.domain) ?? null,
      contactId: null,
      emails: [email],
    });
  }

  const contactAddresses: string[] = [];
  for (const contact of contacts) {
    const emails = contact.emails
      .map((e) => e.email.toLowerCase())
      .filter((e) => !isOwnAddress(e, own));
    if (emails.length === 0) continue;
    for (const email of emails) {
      const existing = byEmail.get(email);
      if (existing) {
        existing.displayName = contact.name || existing.displayName;
        existing.contactId = contact.id;
        existing.emails = emails;
      } else {
        contactAddresses.push(email);
        byEmail.set(email, {
          email,
          displayName: contact.name,
          domain: email.split("@")[1] ?? "",
          score: 0,
          contactId: contact.id,
          emails,
        });
      }
    }
  }

  if (byEmail.size === 0) return [];
  const addresses = [...byEmail.keys()];

  const [senders, contactScores] = await Promise.all([
    db.sender.findMany({
      where: { userId, email: { in: addresses } },
      select: {
        email: true,
        displayName: true,
        status: true,
        category: true,
        contactEmails: { select: { contactId: true }, take: 1 },
      },
    }),
    contactAddresses.length > 0
      ? db.personRank.findMany({
          where: { userId, email: { in: contactAddresses } },
          select: { email: true, score: true },
        })
      : Promise.resolve([] as { email: string; score: number }[]),
  ]);

  for (const row of contactScores) {
    const c = byEmail.get(row.email.toLowerCase());
    if (c) c.score = row.score;
  }

  // A sender the user rejected or has not screened yet is left out, unless
  // the address belongs to a Contact record: Contacts are always offered.
  const category = new Map<string, SenderCategory | null>();
  for (const s of senders) {
    const email = s.email.toLowerCase();
    const c = byEmail.get(email);
    if (!c) continue;
    if (s.status !== "APPROVED" && !c.contactId) {
      byEmail.delete(email);
      continue;
    }
    if (!c.contactId) {
      c.displayName = s.displayName || c.displayName;
      c.contactId = s.contactEmails[0]?.contactId ?? null;
    }
    category.set(email, s.category);
  }

  // One row per contact: its best-ranked matching address.
  const hits = rankedPeople([...byEmail.values()], q, Number.MAX_SAFE_INTEGER);
  const seenContacts = new Set<string>();
  const out: PeopleHit[] = [];
  for (const hit of hits) {
    if (hit.contactId) {
      if (seenContacts.has(hit.contactId)) continue;
      seenContacts.add(hit.contactId);
    }
    out.push({
      email: hit.email,
      displayName: hit.displayName,
      domain: hit.domain,
      score: hit.score,
      matchedBy: hit.matchedBy,
      domainHint: hit.domainHint,
      contactId: hit.contactId,
      emails: hit.emails,
      category: category.get(hit.email) ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
