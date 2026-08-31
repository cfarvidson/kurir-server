import { db } from "@/lib/db";
import {
  computePersonStats,
  type PersonStats,
} from "@/lib/mail/person-stats";
import {
  mergeContactDetails,
  type MergedProfileDetails,
} from "@/lib/mail/signature-extract";
import { getOwnAddresses } from "@/lib/mail/user-emails";

/**
 * The person profile served to web and mobile (kurir-ios#116): contact
 * details with their source (Contact record wins, signature fills gaps),
 * plus statistics and Rank over all of the user's mail regardless of list.
 */
export interface PersonProfile extends MergedProfileDetails {
  email: string;
  /** Best available name: Contact, then the sender header, then local part. */
  displayName: string;
  signatureExtractedAt: Date | null;
  timeZone: string;
  stats: PersonStats;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getPersonProfile(
  userId: string,
  rawEmail: string,
  options: { timeZone?: string | null; now?: Date } = {},
): Promise<PersonProfile> {
  const email = rawEmail.trim().toLowerCase();
  const now = options.now ?? new Date();

  const [sender, linked, user, own, rows] = await Promise.all([
    // Senders are per connection; prefer the row that has been scanned.
    db.sender.findFirst({
      where: { userId, email: { equals: email, mode: "insensitive" } },
      select: {
        displayName: true,
        signaturePhones: true,
        signatureTitle: true,
        signatureCompany: true,
        signatureExtractedAt: true,
      },
      orderBy: [{ signatureExtractedAt: { sort: "desc", nulls: "last" } }],
    }),
    db.contactEmail.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, contact: { userId } },
      select: { contact: { select: { name: true } } },
    }),
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    getOwnAddresses(userId),
    db.message.findMany({
      where: { userId, isDraft: false },
      select: {
        fromAddress: true,
        toAddresses: true,
        ccAddresses: true,
        receivedAt: true,
        messageId: true,
        inReplyTo: true,
      },
    }),
  ]);

  const timeZone = isValidTimeZone(options.timeZone)
    ? options.timeZone
    : isValidTimeZone(user?.timezone)
      ? user.timezone
      : "UTC";

  const details = mergeContactDetails(
    linked ? { name: linked.contact.name, phones: [] } : null,
    {
      phones: sender?.signaturePhones ?? [],
      title: sender?.signatureTitle ?? undefined,
      company: sender?.signatureCompany ?? undefined,
    },
  );

  const stats = computePersonStats({ messages: rows, email, own, now, timeZone });

  return {
    email,
    displayName:
      details.name?.value ||
      sender?.displayName ||
      email.split("@")[0] ||
      email,
    ...details,
    signatureExtractedAt: sender?.signatureExtractedAt ?? null,
    timeZone,
    stats,
  };
}
