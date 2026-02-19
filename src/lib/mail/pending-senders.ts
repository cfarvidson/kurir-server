import { Prisma } from "@prisma/client";

/**
 * Pending senders are only visible in Screener surfaces once they have at
 * least one non-archived message.
 */
export function visiblePendingSenderWhere(
  userId: string,
  excludedEmail?: string | null,
): Prisma.SenderWhereInput {
  const normalizedExcludedEmail = excludedEmail?.trim().toLowerCase();

  return {
    userId,
    status: "PENDING",
    ...(normalizedExcludedEmail
      ? {
          NOT: { email: normalizedExcludedEmail },
        }
      : {}),
    messages: {
      some: { isArchived: false },
    },
  };
}
