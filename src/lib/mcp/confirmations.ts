import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashArgs } from "@/lib/mcp/canonical-json";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

type ConsumeBinding = {
  id: string;
  userId: string;
  tokenId: string;
  toolName: string;
  args: unknown;
};

/**
 * Create a pending MRTR confirmation handle bound to tool args (hashed).
 * Handle is single-use and expires after 10 minutes.
 */
export async function createConfirmation(input: {
  userId: string;
  tokenId: string;
  toolName: string;
  args: unknown;
}): Promise<{ id: string; message: string }> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);

  await db.mcpConfirmation.create({
    data: {
      id,
      userId: input.userId,
      tokenId: input.tokenId,
      toolName: input.toolName,
      argsHash: hashArgs(input.args),
      argsJson: input.args as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return {
    id,
    message: `Confirm ${input.toolName}`,
  };
}

async function matchConfirmation(
  client: Prisma.TransactionClient | typeof db,
  input: ConsumeBinding,
): Promise<boolean> {
  const row = await client.mcpConfirmation.findUnique({
    where: { id: input.id },
    select: {
      userId: true,
      tokenId: true,
      toolName: true,
      argsHash: true,
      expiresAt: true,
    },
  });
  if (!row) return false;
  if (row.userId !== input.userId) return false;
  if (row.tokenId !== input.tokenId) return false;
  if (row.toolName !== input.toolName) return false;
  if (row.argsHash !== hashArgs(input.args)) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/**
 * Validate and consume a confirmation outside a mutation transaction.
 * Returns "accept" | "cancel" | "mismatch". On accept, caller performs the
 * side effect next; use consumeConfirmationInTx when the consume must be
 * atomic with the mutation.
 */
export async function consumeConfirmation(input: {
  id: string;
  userId: string;
  tokenId: string;
  toolName: string;
  args: unknown;
  action: string | undefined;
}): Promise<"accept" | "cancel" | "mismatch"> {
  const matched = await matchConfirmation(db, input);
  if (!matched) return "mismatch";

  if (input.action !== "accept") {
    await db.mcpConfirmation.updateMany({
      where: { id: input.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return "cancel";
  }

  const { count } = await db.mcpConfirmation.updateMany({
    where: { id: input.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) return "mismatch";
  return "accept";
}

/**
 * Consume a confirmation inside an existing Prisma transaction (accept path).
 * Returns true when the handle was valid and marked consumed.
 */
export async function consumeConfirmationInTx(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    tokenId: string;
    toolName: string;
    args: unknown;
  },
): Promise<boolean> {
  const matched = await matchConfirmation(tx, input);
  if (!matched) return false;

  const { count } = await tx.mcpConfirmation.updateMany({
    where: { id: input.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return count > 0;
}
