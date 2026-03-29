"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { triggerSyncForConnection } from "@/actions/admin-connections";
import { toast } from "sonner";

interface SyncConnection {
  id: string;
  email: string;
  imapHost: string;
  isDefault: boolean;
  userName: string | null;
  syncState: {
    isSyncing: boolean;
    syncStartedAt: string | null;
    syncError: string | null;
    lastFullSync: string | null;
    lastSyncLog: string | null;
  } | null;
}

interface SyncSectionProps {
  connections: SyncConnection[];
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function getSyncStatus(syncState: SyncConnection["syncState"]): {
  color: string;
  label: string;
  pulse: boolean;
} {
  if (!syncState || !syncState.lastFullSync) {
    return { color: "bg-gray-400", label: "Never synced", pulse: false };
  }

  if (syncState.isSyncing) {
    return { color: "bg-yellow-500", label: "Syncing", pulse: true };
  }

  if (syncState.syncError) {
    return { color: "bg-destructive", label: "Error", pulse: false };
  }

  const lastSync = new Date(syncState.lastFullSync).getTime();
  const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
  if (lastSync > fifteenMinAgo) {
    return { color: "bg-green-500", label: "Healthy", pulse: false };
  }

  return { color: "bg-yellow-500", label: "Stale", pulse: false };
}

function SyncConnectionRow({ connection }: { connection: SyncConnection }) {
  const [, startAction] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [expandedError, setExpandedError] = useState(false);
  const [expandedLog, setExpandedLog] = useState(false);

  const status = getSyncStatus(connection.syncState);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* User and email */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {connection.userName || "Unnamed user"}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {connection.email}
            </span>
            {connection.isDefault && (
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">
                default
              </span>
            )}
          </div>

          {/* IMAP host and status */}
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{connection.imapHost}</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${status.color} ${status.pulse ? "animate-pulse" : ""}`}
              />
              {status.label}
            </span>
          </div>

          {/* Last sync time */}
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            {connection.syncState?.lastFullSync ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span>
                  Last sync: {timeAgo(connection.syncState.lastFullSync)}
                </span>
              </>
            ) : (
              <>
                <Clock className="h-3 w-3" />
                <span>Never synced</span>
              </>
            )}
          </div>
        </div>

        {/* Trigger sync button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs shrink-0"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            startAction(async () => {
              try {
                await triggerSyncForConnection(connection.id);
                toast.success(`Sync triggered for ${connection.email}`);
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
          Sync
        </Button>
      </div>

      {/* Error message (expandable) */}
      {connection.syncState?.syncError && (
        <button
          onClick={() => setExpandedError(!expandedError)}
          className="mt-2 flex items-start gap-1.5 text-xs text-destructive text-left w-full"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className={expandedError ? "" : "line-clamp-1"}>
            {connection.syncState.syncError}
          </span>
        </button>
      )}

      {/* Sync log (expandable) */}
      {connection.syncState?.lastSyncLog && (
        <button
          onClick={() => setExpandedLog(!expandedLog)}
          className="mt-2 text-xs text-muted-foreground text-left w-full"
        >
          {expandedLog ? (
            <pre className="whitespace-pre-wrap font-mono text-[11px] bg-muted/50 rounded p-2 mt-1">
              {connection.syncState.lastSyncLog}
            </pre>
          ) : (
            <span className="underline decoration-dotted underline-offset-2">
              Show sync log
            </span>
          )}
        </button>
      )}
    </div>
  );
}

export function SyncSection({ connections }: SyncSectionProps) {
  if (connections.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-medium">Sync Status</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No email connections found.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Sync Status</h2>
      <div className="mt-4 space-y-3">
        {connections.map((conn) => (
          <SyncConnectionRow key={conn.id} connection={conn} />
        ))}
      </div>
    </section>
  );
}
