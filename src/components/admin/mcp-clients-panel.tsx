"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { McpClientInfo } from "@/actions/mcp-clients";
import { createMcpClient, deleteMcpClient } from "@/actions/mcp-clients";

export function McpClientsPanel({ clients }: { clients: McpClientInfo[] }) {
  const [isCreating, startCreate] = useTransition();
  const [, startDelete] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const uris = redirectUris
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);

    startCreate(async () => {
      try {
        const result = await createMcpClient(name.trim(), uris);
        await copy(result.clientId, "Client registered, client_id copied");
        setShowForm(false);
        setName("");
        setRedirectUris("");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to register client",
        );
      }
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">MCP clients</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sm"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-4 w-4" />
          Register client
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        For MCP hosts that cannot publish a client metadata document. Clients
        are public (PKCE, no secret). Authorization server:{" "}
        <code className="font-mono text-xs">{baseUrl || "this instance"}</code>
      </p>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-lg border bg-card p-4 space-y-3"
        >
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grok Bot"
              className="mt-1"
              maxLength={80}
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              Redirect URIs{" "}
              <span className="text-muted-foreground font-normal">
                (one per line)
              </span>
            </label>
            <textarea
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              placeholder={"https://host.example/oauth/callback\nhttp://localhost/callback"}
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              rows={3}
              spellCheck={false}
              autoComplete="off"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Absolute https URLs, or http on localhost / 127.0.0.1 (any port).
              Must match the client&apos;s redirect exactly.
            </p>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={isCreating || !name.trim() || !redirectUris.trim()}
          >
            {isCreating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Register
          </Button>
        </form>
      )}

      <div className="mt-4 rounded-lg border bg-card divide-y">
        {clients.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No registered clients
          </p>
        ) : (
          clients.map((client) => (
            <div
              key={client.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{client.name}</p>
                <button
                  type="button"
                  className="mt-0.5 flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => copy(client.clientId, "client_id copied")}
                  title="Copy client_id"
                >
                  <code className="truncate font-mono">{client.clientId}</code>
                  <Copy className="h-3 w-3 shrink-0" />
                </button>
                <ul className="mt-1 space-y-0.5">
                  {client.redirectUris.map((uri) => (
                    <li
                      key={uri}
                      className="truncate font-mono text-xs text-muted-foreground"
                    >
                      {uri}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Registered {new Date(client.createdAt).toLocaleDateString()}
                  {" · "}
                  {client.connectionCount}{" "}
                  {client.connectionCount === 1 ? "connection" : "connections"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={deletingId === client.id}
                title="Delete client and revoke its connections"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete "${client.name}" and revoke its ${client.connectionCount} connection(s)?`,
                    )
                  ) {
                    return;
                  }
                  setDeletingId(client.id);
                  startDelete(async () => {
                    try {
                      await deleteMcpClient(client.id);
                      toast.success("Client deleted");
                    } catch {
                      toast.error("Failed to delete client");
                    } finally {
                      setDeletingId(null);
                    }
                  });
                }}
              >
                {deletingId === client.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
