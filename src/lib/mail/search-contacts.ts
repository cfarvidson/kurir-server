import { db } from "@/lib/db";

export interface ContactSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  category: "IMBOX" | "FEED" | "PAPER_TRAIL";
  domain: string;
  contactId: string | null;
}

export type PersonHitInput = {
  id?: string;
  email: string;
  displayName: string | null;
  domain: string;
  category?: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
  contactId?: string | null;
};

export function personMatchesQuery(
  person: PersonHitInput,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (person.email.toLowerCase().includes(needle)) return true;
  if ((person.displayName ?? "").toLowerCase().includes(needle)) return true;
  if (person.domain.toLowerCase().includes(needle)) return true;
  return false;
}

/** Prefer the address that matched the query, else primary (first). */
export function personHitFromContact(
  id: string,
  name: string,
  emails: string[],
  query: string,
): PersonHitInput | null {
  const matching = emails.find((email) =>
    personMatchesQuery(
      {
        email,
        displayName: name,
        domain: email.split("@")[1] ?? "",
      },
      query,
    ),
  );
  const email = matching ?? emails[0];
  if (!email) return null;
  const hit: PersonHitInput = {
    id,
    email,
    displayName: name,
    domain: email.split("@")[1] ?? "",
    category: null,
    contactId: id,
  };
  return personMatchesQuery(hit, query) ? hit : null;
}

function toResult(hit: PersonHitInput): ContactSearchResult {
  return {
    id: hit.id ?? hit.email,
    email: hit.email,
    displayName: hit.displayName,
    category: hit.category ?? "IMBOX",
    domain: hit.domain,
    contactId: hit.contactId ?? null,
  };
}

/** Merge sender + contact hits: People group, contact name wins on dupes. */
export function mergePersonHits(
  senders: PersonHitInput[],
  contacts: PersonHitInput[],
  query: string,
  limit = 5,
): ContactSearchResult[] {
  const byEmail = new Map<string, ContactSearchResult>();

  for (const sender of senders) {
    if (!personMatchesQuery(sender, query)) continue;
    byEmail.set(sender.email.toLowerCase(), toResult(sender));
  }

  for (const contact of contacts) {
    if (!personMatchesQuery(contact, query)) continue;
    const key = contact.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      byEmail.set(key, {
        ...existing,
        displayName: contact.displayName || existing.displayName,
        contactId: contact.contactId ?? existing.contactId,
      });
    } else {
      byEmail.set(key, toResult(contact));
    }
  }

  return [...byEmail.values()]
    .sort((a, b) => {
      const an = (a.displayName || a.email).localeCompare(
        b.displayName || b.email,
        undefined,
        { sensitivity: "base" },
      );
      if (an !== 0) return an;
      return a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
}

export async function searchContacts(
  userId: string,
  query: string,
  limit = 5,
): Promise<ContactSearchResult[]> {
  if (query.trim().length < 1) return [];

  const [senders, contacts] = await Promise.all([
    db.sender.findMany({
      where: {
        userId,
        status: "APPROVED",
        OR: [
          { email: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } },
          { domain: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        category: true,
        domain: true,
        contactEmails: {
          select: { contactId: true },
          take: 1,
        },
      },
      take: 20,
    }),
    db.contact.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          {
            emails: {
              some: { email: { contains: query, mode: "insensitive" } },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        emails: {
          select: { email: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      take: 20,
    }),
  ]);

  const senderHits: PersonHitInput[] = senders.map((s) => ({
    id: s.id,
    email: s.email,
    displayName: s.displayName,
    domain: s.domain,
    category: s.category,
    contactId: s.contactEmails[0]?.contactId ?? null,
  }));

  const contactHits: PersonHitInput[] = contacts.flatMap((c) => {
    const hit = personHitFromContact(c.id, c.name, c.emails.map((e) => e.email), query);
    return hit ? [hit] : [];
  });

  return mergePersonHits(senderHits, contactHits, query, limit);
}
