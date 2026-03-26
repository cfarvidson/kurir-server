import { db } from "@/lib/db";

export interface ContactSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  category: "IMBOX" | "FEED" | "PAPER_TRAIL";
  domain: string;
}

export async function searchContacts(
  userId: string,
  query: string,
  limit = 5,
): Promise<ContactSearchResult[]> {
  if (query.length < 1) return [];

  const contacts = await db.sender.findMany({
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
    },
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
    take: limit,
  });

  return contacts as ContactSearchResult[];
}
