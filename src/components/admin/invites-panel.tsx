"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInvite, revokeInvite } from "@/actions/invites";
import { Copy, Loader2, Plus, Trash2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

interface Invite {
  id: string;
  token: string;
  displayName: string;
  emailHint: string | null;
  expiresAt: string;
  createdAt: string;
}

export function InvitesPanel({ invites }: { invites: Invite[] }) {
  const [isCreating, startCreate] = useTransition();
  const [, startRevoke] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [emailHint, setEmailHint] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    startCreate(async () => {
      try {
        const result = await createInvite(
          name.trim(),
          emailHint.trim() || undefined,
        );
        const link = `${baseUrl}/register?invite=${result.token}`;
        await navigator.clipboard.writeText(link);
        toast.success("Invite created and link copied to clipboard");
        setShowForm(false);
        setName("");
        setEmailHint("");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create invite",
        );
      }
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Invites</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sm"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-4 w-4" />
          Invite user
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-lg border bg-card p-4 space-y-3"
        >
          <div>
            <label className="text-sm font-medium">Display name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alice"
              className="mt-1"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              Email hint{" "}
              <span className="text-muted-foreground font-normal">
                (optional, for your reference)
              </span>
            </label>
            <Input
              value={emailHint}
              onChange={(e) => setEmailHint(e.target.value)}
              placeholder="e.g. alice@example.com"
              className="mt-1"
            />
          </div>
          <Button type="submit" size="sm" disabled={isCreating || !name.trim()}>
            {isCreating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Create invite
          </Button>
        </form>
      )}

      <div className="mt-4 rounded-lg border bg-card divide-y">
        {invites.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No pending invites
          </p>
        ) : (
          invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-sm font-medium truncate">
                    {invite.displayName}
                  </p>
                  {invite.emailHint && (
                    <span className="text-xs text-muted-foreground truncate">
                      ({invite.emailHint})
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(invite.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const link = `${baseUrl}/register?invite=${invite.token}`;
                    await navigator.clipboard.writeText(link);
                    toast.success("Invite link copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokingId === invite.id}
                  onClick={() => {
                    setRevokingId(invite.id);
                    startRevoke(async () => {
                      try {
                        await revokeInvite(invite.id);
                        toast.success("Invite revoked");
                      } catch {
                        toast.error("Failed to revoke invite");
                      } finally {
                        setRevokingId(null);
                      }
                    });
                  }}
                >
                  {revokingId === invite.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
