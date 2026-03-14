import { Prisma } from "@prisma/client";

/**
 * Pending senders are only visible in Screener surfaces once they have at
 * least one non-archived message.
 */
export function visiblePendingSenderWhere(
  userId: string,
  excludedEmails?: string[] | null,
): Prisma.SenderWhereInput {
  return {
    userId,
    status: "PENDING",
    ...(excludedEmails?.length
      ? { NOT: { email: { in: excludedEmails } } }
      : {}),
    messages: {
      some: { isArchived: false },
    },
  };
}
