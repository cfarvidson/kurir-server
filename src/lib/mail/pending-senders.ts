import { Prisma } from "@prisma/client";

/**
 * Pending senders are only visible in Screener surfaces once they have at
 * least one non-archived message.
 */
export function visiblePendingSenderWhere(
  userId: string,
): Prisma.SenderWhereInput {
  return {
    userId,
    status: "PENDING",
    messages: {
      some: { isArchived: false },
    },
  };
}
