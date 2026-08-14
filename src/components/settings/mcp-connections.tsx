"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { McpConnectionInfo } from "@/actions/mcp-tokens";
import { revokeMcpConnection } from "@/actions/mcp-tokens";

interface McpConnectionsProps {
  connections: McpConnectionInfo[];
}

export function McpConnections({ connections }: McpConnectionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = (id: string) => {
    setError(null);
    setRevokingId(id);
    startTransition(async () => {
      try {
        await revokeMcpConnection(id);
        router.refresh();
      } catch {
        setError("Could not revoke this app. Try again.");
      } finally {
        setRevokingId(null);
      }
    });
  };

  if (connections.length === 0) {
    return <p className="text-sm text-muted-foreground">No connected apps</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="divide-y divide-border border-y border-border">
        {connections.map((connection) => (
          <div
            key={connection.id}
            className="flex items-center justify-between gap-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {connection.clientName?.trim() || "Unknown app"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                Connected {new Date(connection.createdAt).toLocaleDateString()}
                {" · "}
                Last used {new Date(connection.lastUsedAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRevoke(connection.id)}
              disabled={isPending}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              {revokingId === connection.id ? "Revoking..." : "Revoke"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
