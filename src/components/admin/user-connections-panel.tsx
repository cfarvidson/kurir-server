"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addConnectionForUser,
  deleteConnectionForUser,
  triggerSyncForConnection,
} from "@/actions/admin-connections";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface ConnectionInfo {
  id: string;
  email: string;
  displayName: string | null;
  imapHost: string;
  smtpHost: string;
  isDefault: boolean;
  createdAt: string;
  syncState: {
    isSyncing: boolean;
    syncError: string | null;
    lastFullSync: string | null;
    lastSyncLog: string | null;
  } | null;
}

interface UserInfo {
  id: string;
  displayName: string | null;
  connections: ConnectionInfo[];
}

export function UserConnectionsPanel({ users }: { users: UserInfo[] }) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-lg font-medium">User Connections</h2>
      <div className="mt-4 rounded-lg border bg-card divide-y">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            expanded={expandedUser === user.id}
            onToggle={() =>
              setExpandedUser(expandedUser === user.id ? null : user.id)
            }
            showAddForm={showAddForm === user.id}
            onToggleAddForm={() =>
              setShowAddForm(showAddForm === user.id ? null : user.id)
            }
          />
        ))}
      </div>
    </section>
  );
}

function UserRow({
  user,
  expanded,
  onToggle,
  showAddForm,
  onToggleAddForm,
}: {
  user: UserInfo;
  expanded: boolean;
  onToggle: () => void;
  showAddForm: boolean;
  onToggleAddForm: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {user.displayName || "Unnamed user"}
          </span>
          <span className="text-xs text-muted-foreground">
            {user.connections.length} connection
            {user.connections.length !== 1 ? "s" : ""}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-3 space-y-2">
          {user.connections.map((conn) => (
            <ConnectionRow key={conn.id} connection={conn} />
          ))}

          {showAddForm ? (
            <AddConnectionForm userId={user.id} onClose={onToggleAddForm} />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={onToggleAddForm}
            >
              <Plus className="h-3.5 w-3.5" />
              Add connection
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({ connection }: { connection: ConnectionInfo }) {
  const [, startAction] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const syncState = connection.syncState;
  const hasError = syncState?.syncError;
  const lastSync = syncState?.lastFullSync
    ? new Date(syncState.lastFullSync).toLocaleString()
    : "Never";

  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium truncate">
            {connection.email}
          </span>
          {connection.isDefault && (
            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">
              default
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Server className="h-3 w-3" />
            {connection.imapHost}
          </span>
          <span className="flex items-center gap-1">
            {hasError ? (
              <AlertCircle className="h-3 w-3 text-destructive" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
            Last sync: {lastSync}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 ml-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            startAction(async () => {
              try {
                await triggerSyncForConnection(connection.id);
                toast.success("Sync triggered");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Sync failed");
              } finally {
                setSyncing(false);
              }
            });
          }}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => {
            if (
              !confirm(
                `Delete connection ${connection.email}? All synced messages will be removed.`,
              )
            )
              return;
            setDeleting(true);
            startAction(async () => {
              try {
                await deleteConnectionForUser(connection.id);
                toast.success("Connection deleted");
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Delete failed",
                );
              } finally {
                setDeleting(false);
              }
            });
          }}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

function AddConnectionForm({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await addConnectionForUser(userId, {
          email,
          password,
          imapHost,
          imapPort: parseInt(imapPort, 10),
          smtpHost,
          smtpPort: parseInt(smtpPort, 10),
        });
        toast.success("Connection added");
        onClose();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to add connection",
        );
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border bg-card p-3 space-y-2"
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            type="email"
            required
          />
        </div>
        <div className="col-span-2">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password / App password"
            type="password"
            required
          />
        </div>
        <Input
          value={imapHost}
          onChange={(e) => setImapHost(e.target.value)}
          placeholder="IMAP host"
          required
        />
        <Input
          value={imapPort}
          onChange={(e) => setImapPort(e.target.value)}
          placeholder="IMAP port"
          type="number"
          required
        />
        <Input
          value={smtpHost}
          onChange={(e) => setSmtpHost(e.target.value)}
          placeholder="SMTP host"
          required
        />
        <Input
          value={smtpPort}
          onChange={(e) => setSmtpPort(e.target.value)}
          placeholder="SMTP port"
          type="number"
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
