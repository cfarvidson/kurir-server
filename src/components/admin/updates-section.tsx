"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface UpdateStatus {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  latestReleaseUrl: string | null;
  latestChangelog: string | null;
  lastUpdateCheck: string | null;
  updateMode: string;
  history: UpdateLogEntry[];
}

interface UpdateLogEntry {
  id: string;
  createdAt: string;
  fromVersion: string;
  toVersion: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  triggeredBy: string;
  completedAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    rolled_back:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    started: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pulling: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    restarting:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    verifying:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function RelativeTime({ date }: { date: string }) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return <span>just now</span>;
  if (diffMins < 60) return <span>{diffMins}m ago</span>;
  if (diffHours < 24) return <span>{diffHours}h ago</span>;
  return <span>{diffDays}d ago</span>;
}

export function UpdatesSection({
  versionInfo,
}: {
  versionInfo: { version: string };
}) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/updates");
      if (!res.ok) throw new Error("Failed to fetch update status");
      setStatus(await res.json());
      setError(null);
    } catch {
      setError("Failed to load update status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/updates/check", { method: "POST" });
      if (!res.ok) throw new Error("Check failed");
      await fetchStatus();
    } catch {
      setError("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    setConfirmUpdate(false);
    try {
      const res = await fetch("/api/admin/updates/apply", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Update failed");
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleRollback = async () => {
    try {
      const res = await fetch("/api/admin/updates/rollback", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Rollback failed");
      await fetchStatus();
    } catch {
      setError("Failed to trigger rollback");
    }
  };

  const handleModeChange = async (mode: string) => {
    try {
      const res = await fetch("/api/admin/updates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateMode: mode }),
      });
      if (!res.ok) throw new Error("Failed to update mode");
      await fetchStatus();
    } catch {
      setError("Failed to change update mode");
    }
  };

  if (loading && !status) {
    return (
      <section>
        <h2 className="text-lg font-medium">Updates</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Loading...
        </div>
      </section>
    );
  }

  if (error && !status) {
    return (
      <section>
        <h2 className="text-lg font-medium">Updates</h2>
        <div className="mt-4 rounded-lg border bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      </section>
    );
  }

  if (!status) return null;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Updates</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCheck}
          disabled={checking}
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {/* Current Version & Update Status */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {status.updateAvailable ? (
                  <ArrowDownCircle className="h-4 w-4 text-blue-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                {status.updateAvailable ? "Update Available" : "Up to Date"}
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">Current:</span>{" "}
                  <span className="font-medium">v{versionInfo.version}</span>
                </div>
                {status.latestVersion && (
                  <div>
                    <span className="text-muted-foreground">Latest:</span>{" "}
                    <span className="font-medium">v{status.latestVersion}</span>
                  </div>
                )}
                {status.lastUpdateCheck && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Checked:</span>{" "}
                    <RelativeTime date={status.lastUpdateCheck} />
                  </div>
                )}
              </div>
            </div>

            {status.updateAvailable && (
              <div className="flex gap-2">
                {status.latestReleaseUrl && (
                  <a
                    href={status.latestReleaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Release notes
                  </a>
                )}
                {!confirmUpdate ? (
                  <Button
                    size="sm"
                    onClick={() => setConfirmUpdate(true)}
                    disabled={updating}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    Update Now
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Are you sure?
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleUpdate}
                      disabled={updating}
                    >
                      {updating ? "Updating..." : "Confirm"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmUpdate(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {status.latestChangelog && status.updateAvailable && (
            <div className="mt-3 rounded border bg-muted/50 p-3 text-xs">
              <p className="font-medium text-muted-foreground mb-1">
                Changelog
              </p>
              <p>{status.latestChangelog}</p>
            </div>
          )}
        </div>

        {/* Update Mode Setting */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Update Mode
          </div>
          <div className="mt-3 flex gap-2">
            {(["off", "notify", "auto"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  status.updateMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "off"
                  ? "Off"
                  : mode === "notify"
                    ? "Notify Only"
                    : "Auto-Apply"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {status.updateMode === "off" && "Update checking is disabled."}
            {status.updateMode === "notify" &&
              "You will be notified when updates are available."}
            {status.updateMode === "auto" &&
              "Updates will be applied automatically after a health check."}
          </p>
        </div>

        {/* Rollback */}
        {status.history.some((h) => h.status === "success") && (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
                Rollback
              </div>
              <Button variant="outline" size="sm" onClick={handleRollback}>
                Rollback to Previous
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Revert to the previous version if the current update has issues.
            </p>
          </div>
        )}

        {/* Update History */}
        {status.history.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-medium mb-3">Update History</h3>
            <div className="space-y-2">
              {status.history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {entry.fromVersion} → {entry.toVersion}
                    </span>
                    <StatusBadge status={entry.status} />
                    <span className="text-muted-foreground">
                      {entry.triggeredBy}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {entry.durationMs && (
                      <span>{Math.round(entry.durationMs / 1000)}s</span>
                    )}
                    <RelativeTime date={entry.createdAt} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
