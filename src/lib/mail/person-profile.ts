import { db } from "@/lib/db";
import {
  computePersonStats,
  rankPeople,
  type PersonStats,
  type RankedPerson,
} from "@/lib/mail/person-stats";
import {
  mergeContactDetails,
  type MergedProfileDetails,
} from "@/lib/mail/person-details";
import {
  mergeSignatureDetails,
  type SignatureDetails,
} from "@/lib/mail/signature-extract";
import { getOwnAddresses, type OwnAddresses } from "@/lib/mail/user-emails";

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

const RANK_COLUMNS = {
  fromAddress: true,
  toAddresses: true,
  ccAddresses: true,
  receivedAt: true,
  messageId: true,
  inReplyTo: true,
} as const;

/**
 * Rank position needs every counterpart, i.e. a pass over the whole
 * mailbox. That pass is cached per user for a minute so opening threads in
 * a row does not re-read the table each time; a minute of decay is
 * invisible in the score. Per process; the next card materialises this.
 */
export const RANKING_CACHE_MS = 60_000;
const rankingCache = new Map<string, { at: number; ranked: RankedPerson[] }>();

export function resetRankingCache(): void {
  rankingCache.clear();
}

async function rankingForUser(
  userId: string,
  own: OwnAddresses,
  now: Date,
): Promise<RankedPerson[]> {
  const hit = rankingCache.get(userId);
  if (hit && now.getTime() - hit.at < RANKING_CACHE_MS) return hit.ranked;
  const rows = await db.message.findMany({
    where: { userId, isDraft: false },
    select: RANK_COLUMNS,
  });
  const ranked = rankPeople(rows, own, now);
  rankingCache.set(userId, { at: now.getTime(), ranked });
  return ranked;
}

export async function getPersonProfile(
  userId: string,
  rawEmail: string,
  options: { timeZone?: string | null; now?: Date } = {},
): Promise<PersonProfile> {
  const email = rawEmail.trim().toLowerCase();
  const now = options.now ?? new Date();
  const variants = [...new Set([rawEmail.trim(), email])];

  const [senders, linked, user, own, involved] = await Promise.all([
    // Senders are per connection: fold every row's details, scanned-newest
    // first, so a phone stored on a sibling connection is not lost.
    db.sender.findMany({
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
    // Everything the person is on: enough for counts, medians, histogram.
    db.message.findMany({
      where: {
        userId,
        isDraft: false,
        OR: [
          { fromAddress: { equals: email, mode: "insensitive" } },
          { toAddresses: { hasSome: variants } },
          { ccAddresses: { hasSome: variants } },
        ],
      },
      select: RANK_COLUMNS,
    }),
  ]);

  const ranking = await rankingForUser(userId, own, now);

  const timeZone = isValidTimeZone(options.timeZone)
    ? options.timeZone
    : isValidTimeZone(user?.timezone)
      ? user.timezone
      : "UTC";

  let signature: SignatureDetails = { phones: [] };
  for (const sender of [...senders].reverse()) {
    signature = mergeSignatureDetails(signature, {
      phones: sender.signaturePhones,
      title: sender.signatureTitle ?? undefined,
      company: sender.signatureCompany ?? undefined,
    });
  }
  const details = mergeContactDetails(
    linked ? { name: linked.contact.name, phones: [] } : null,
    signature,
  );

  const stats = computePersonStats({
    messages: involved,
    email,
    own,
    now,
    timeZone,
    ranking,
  });

  return {
    email,
    displayName:
      details.name?.value ||
      senders.find((s) => s.displayName)?.displayName ||
      email.split("@")[0] ||
      email,
    ...details,
    signatureExtractedAt: senders[0]?.signatureExtractedAt ?? null,
    timeZone,
    stats,
  };
}
