import { db } from "@/lib/db";

/**
 * All addresses belonging to a user across their email connections (primary,
 * send-as, and aliases), lowercased, trimmed, and de-duplicated. Used to
 * exclude the user's own addresses from screener/pending-sender queries.
 */
export async function getUserEmails(userId: string): Promise<string[]> {
  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { email: true, sendAsEmail: true, aliases: true },
  });
  return [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];
}
