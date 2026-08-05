import { Prisma } from "@prisma/client";
import type { OwnAddresses } from "@/lib/mail/user-emails";

/** Positive match: senders whose address is one of the user's own. */
export function ownSenderEmailWhere(
  own: OwnAddresses,
): Prisma.SenderWhereInput | null {
  const or: Prisma.SenderWhereInput[] = [];
  if (own.emails.length > 0) or.push({ email: { in: own.emails } });
  for (const d of own.domains) or.push({ email: { endsWith: `@${d}` } });
  return or.length > 0 ? { OR: or } : null;
}

/**
 * Pending senders are only visible in Screener surfaces once they have at
 * least one non-archived message.
 */
export function visiblePendingSenderWhere(
  userId: string,
  own?: OwnAddresses | null,
): Prisma.SenderWhereInput {
  const ownWhere = own ? ownSenderEmailWhere(own) : null;
  return {
    userId,
    status: "PENDING",
    OR: [{ skippedUntil: null }, { skippedUntil: { lte: new Date() } }],
    ...(ownWhere ? { NOT: ownWhere } : {}),
    messages: { some: { isArchived: false } },
  };
}
