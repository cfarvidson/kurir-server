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

export function ConnectionsList({ connections }: ConnectionsListProps) {
  const router = useRouter();

  const handleSetDefault = async (id: string) => {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/connections/${id}`, {
      method: "DELETE",
    });
    router.refresh();
  };

  const handleSync = async (id: string) => {
    await fetch(`/api/mail/sync?connectionId=${encodeURIComponent(id)}`, {
      method: "POST",
    });
    router.refresh();
  };

  const handleUpdateSendAs = async (id: string, sendAsEmail: string | null) => {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendAsEmail }),
    });
    router.refresh();
  };

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card">
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium">No email accounts connected</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an email account to start using Kurir.
          </p>
          <Button asChild className="mt-4 gap-1.5" size="sm" aria-label="Add another email account">
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
          isOnly={connections.length === 1}
        />
      ))}
    </div>
  );
}
