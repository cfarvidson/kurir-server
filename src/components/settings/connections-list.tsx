"use client";

/**
 * ConnectionsList — renders the list of email connections in settings.
 * Manages server action calls for set-default, delete, and sync.
 */

import { useRouter } from "next/navigation";
import { ConnectionCard, type EmailConnection } from "./connection-card";
import { Mail, PlusCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface ConnectionsListProps {
  connections: EmailConnection[];
}

/**
 * Fetch that fails loudly: rejects with a readable message when the server
 * is unreachable, the request times out, or the response is an error.
 * Without this a stalled request left the connection card disabled forever.
 */
async function request(url: string, init: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 30_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || "The server rejected the change.");
  }
}

export function ConnectionsList({ connections }: ConnectionsListProps) {
  const router = useRouter();

  const patchConnection = async (id: string, body: object) => {
    await request(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  };

  const handleSetDefault = async (id: string) => {
    await patchConnection(id, { isDefault: true });
  };

  const handleDelete = async (id: string) => {
    await request(`/api/connections/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const handleSync = async (id: string) => {
    // Sync can legitimately run for minutes on large mailboxes.
    await request(`/api/mail/sync?connectionId=${encodeURIComponent(id)}`, {
      method: "POST",
      timeoutMs: 300_000,
    });
    router.refresh();
  };

  const handleUpdateSendAs = async (id: string, sendAsEmail: string | null) => {
    await patchConnection(id, { sendAsEmail });
  };

  const handleUpdateAliases = async (id: string, aliases: string[]) => {
    await patchConnection(id, { aliases });
  };

  const handleUpdateTreatDomainAsOwn = async (id: string, value: boolean) => {
    await patchConnection(id, { treatDomainAsOwn: value });
  };

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card">
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            No email accounts connected
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an email account to start using Kurir.
          </p>
          <Button
            asChild
            className="mt-4 gap-1.5"
            size="sm"
            aria-label="Add another email account"
          >
            <Link href="/setup">
              <PlusCircle className="h-4 w-4" />
              Add email account
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {connections.map((conn) => (
        <ConnectionCard
          key={conn.id}
          connection={conn}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
          onSync={handleSync}
          onUpdateSendAs={handleUpdateSendAs}
          onUpdateAliases={handleUpdateAliases}
          onUpdateTreatDomainAsOwn={handleUpdateTreatDomainAsOwn}
          isOnly={connections.length === 1}
        />
      ))}
    </div>
  );
}
