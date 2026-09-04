"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateMcpClientId, validateRedirectUris } from "@/lib/mcp/oauth";

const MAX_NAME_LENGTH = 80;
const MAX_REDIRECT_URIS = 10;

export type McpClientInfo = {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
  connectionCount: number;
};

export async function listMcpClients(): Promise<McpClientInfo[]> {
  await requireAdmin();

  const clients = await db.mcpClient.findMany({
    orderBy: { createdAt: "desc" },
  });
  if (clients.length === 0) return [];

  const counts = await db.mcpToken.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clients.map((c) => c.clientId) } },
    _count: { _all: true },
  });
  const countByClientId = new Map(
    counts.map((row) => [row.clientId, row._count._all]),
  );

  return clients.map((c) => ({
    id: c.id,
    clientId: c.clientId,
    name: c.name,
    redirectUris: c.redirectUris,
    createdAt: c.createdAt.toISOString(),
    connectionCount: countByClientId.get(c.clientId) ?? 0,
  }));
}

/**
 * Register a public OAuth client (PKCE, no secret). Returns the opaque
 * client_id the MCP host should use instead of a CIMD URL.
 */
export async function createMcpClient(
  name: string,
  redirectUris: string[],
): Promise<{ id: string; clientId: string }> {
  const session = await requireAdmin();

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
    throw new Error(`Name is required (max ${MAX_NAME_LENGTH} characters)`);
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    throw new Error(`At most ${MAX_REDIRECT_URIS} redirect URIs`);
  }
  const uris = validateRedirectUris(redirectUris);
  if (!uris) {
    throw new Error(
      "Redirect URIs must be absolute https URLs (or http on localhost / 127.0.0.1) without a fragment",
    );
  }

  const client = await db.mcpClient.create({
    data: {
      clientId: generateMcpClientId(),
      name: trimmedName,
      redirectUris: uris,
      createdBy: session.user.id,
    },
  });

  revalidatePath("/admin");
  return { id: client.id, clientId: client.clientId };
}

/** Delete a registered client and revoke every token issued to it. */
export async function deleteMcpClient(id: string): Promise<void> {
  await requireAdmin();

  const client = await db.mcpClient.findUnique({ where: { id } });
  if (!client) {
    throw new Error("Client not found");
  }

  await db.$transaction([
    db.mcpToken.deleteMany({ where: { clientId: client.clientId } }),
    db.mcpAuthorizationCode.deleteMany({
      where: { clientId: client.clientId },
    }),
    db.mcpClient.delete({ where: { id } }),
  ]);

  revalidatePath("/admin");
}
