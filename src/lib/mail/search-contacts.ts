import { db } from "@/lib/db";

export interface ContactSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  category: "IMBOX" | "FEED" | "PAPER_TRAIL";
  domain: string;
  contactId: string | null;
}

export async function searchContacts(
  userId: string,
  query: string,
  limit = 5,
): Promise<ContactSearchResult[]> {
  if (query.length < 1) return [];

  const senders = await db.sender.findMany({
    where: {
      userId,
      status: "APPROVED",
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
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
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
    take: limit,
  });

  return senders.map((s) => ({
    id: s.id,
    email: s.email,
    displayName: s.displayName,
    category: s.category,
    domain: s.domain,
    contactId: s.contactEmails[0]?.contactId ?? null,
  })) as ContactSearchResult[];
}
