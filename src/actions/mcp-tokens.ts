"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeMcpTokenById } from "@/lib/mcp/tokens";

export type McpConnectionInfo = {
  id: string;
  clientName: string | null;
  createdAt: string;
  lastUsedAt: string;
};

export async function listMcpConnections(): Promise<McpConnectionInfo[]> {
  const session = await requireAuth();

  const rows = await db.mcpToken.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clientName: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    clientName: row.clientName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  }));
}

export async function revokeMcpConnection(tokenId: string): Promise<void> {
  const session = await requireAuth();

  const revoked = await revokeMcpTokenById(session.user.id, tokenId);
  if (!revoked) {
    throw new Error("Connected app not found");
  }

  revalidatePath("/settings");
}
