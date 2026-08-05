import { db } from "@/lib/db";

/** Exact own addresses + wildcard domains (from treatDomainAsOwn). */
export interface OwnAddresses {
  emails: string[];
  domains: string[];
}

export async function getOwnAddresses(userId: string): Promise<OwnAddresses> {
  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: {
      email: true,
      sendAsEmail: true,
      aliases: true,
      treatDomainAsOwn: true,
    },
  });
  const emails = [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];
  const domains = [
    ...new Set(
      connections
        .filter((c) => c.treatDomainAsOwn)
        .map((c) => c.email.trim().toLowerCase().split("@")[1])
        .filter(Boolean),
    ),
  ];
  return { emails, domains };
}

/** Case-insensitive match against exact addresses and wildcard domains. */
export function isOwnAddress(email: string, own: OwnAddresses): boolean {
  const lower = email.trim().toLowerCase();
  if (own.emails.includes(lower)) return true;
  const domain = lower.split("@")[1];
  return !!domain && own.domains.includes(domain);
}

/**
 * All addresses belonging to a user across their email connections (primary,
 * send-as, and aliases), lowercased, trimmed, and de-duplicated. Used to
 * exclude the user's own addresses from screener/pending-sender queries.
 */
export async function getUserEmails(userId: string): Promise<string[]> {
  const own = await getOwnAddresses(userId);
  return own.emails;
}
