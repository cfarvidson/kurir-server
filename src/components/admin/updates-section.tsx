"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import changelog from "@/../changelog.json";
import {
  ACTIVE_UPDATE_STATUSES,
  UPDATER_REFRESH_COMMAND,
} from "@/lib/updates/constants";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/updates/compare-versions";

interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

interface UpdateStatus {
  currentVersion: string;
  updateAvailable: boolean;
  runningAheadOfStable?: boolean;
  latestVersion: string | null;
  latestReleaseUrl: string | null;
  latestChangelog: string | null;
  lastUpdateCheck: string | null;
  imageAvailable?: boolean | null;
  imageCheckedAt?: string | null;
  updateMode: string;
  updateChannel: "stable" | "beta";
  updater: {
    configured: boolean;
    reachable: boolean;
    protocolVersion: number | null;
    stale: boolean;
  } | null;
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

function ExpandToggle({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {expanded ? "Show less" : label}
    </button>
  );
}

function RunRow({ entry }: { entry: UpdateLogEntry }) {
  return (
    <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            {entry.fromVersion} → {entry.toVersion}
          </span>
          <StatusBadge status={entry.status} />
          <span className="text-muted-foreground">{entry.triggeredBy}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {entry.durationMs && (
            <span>{Math.round(entry.durationMs / 1000)}s</span>
          )}
          <RelativeTime date={entry.createdAt} />
        </div>
      </div>
      {entry.status === "failed" && entry.error && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {entry.error}
        </pre>
      )}
    </div>
  );
}

function ChangelogRelease({
  release,
  currentVersion,
}: {
  release: ChangelogEntry;
  currentVersion: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium">v{release.version}</span>
        {release.date && (
          <span className="text-xs text-muted-foreground">{release.date}</span>
        )}
        {release.version === currentVersion && (
          <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            current
          </span>
        )}
      </div>
      <ul className="space-y-0.5">
        {release.changes.map((change, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
            {change}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Entries with `from < version <= to`, newest first (changelog.json order). */
function releasesBetween(
  entries: ChangelogEntry[],
  from: string,
  to: string,
): ChangelogEntry[] {
  return entries.filter(
    (e) =>
      compareVersions(e.version, from) > 0 &&
      compareVersions(e.version, to) <= 0,
  );
}

interface WhatsNew {
  heading: string;
  releases: ChangelogEntry[];
  /** The target's entry was not in the bundled changelog; a manifest line stands in. */
  fromManifest: boolean;
}

/**
 * The versions you get by installing, or (ahead of stable) the ones you
 * have beyond the stable pointer. Empty when up to date.
 */
export function whatsNewFor(
  entries: ChangelogEntry[],
  status: Pick<
    UpdateStatus,
    | "updateAvailable"
    | "runningAheadOfStable"
    | "latestVersion"
    | "latestChangelog"
  >,
  currentVersion: string,
): WhatsNew {
  const aheadOfStable = status.runningAheadOfStable && !status.updateAvailable;
  if (status.updateAvailable && status.latestVersion) {
    let releases = releasesBetween(
      entries,
      currentVersion,
      status.latestVersion,
    );
    let fromManifest = false;
    if (!releases.some((e) => e.version === status.latestVersion)) {
      // The bundled changelog describes the running version; the target's
      // entry only exists in the newer image. Fall back to the manifest line.
      fromManifest = true;
      releases = [
        {
          version: status.latestVersion,
          date: "",
          changes: status.latestChangelog ? [status.latestChangelog] : [],
        },
        ...releases,
      ];
    }
    return {
      heading:
        releases.length > 1
          ? `What's new: v${currentVersion} → v${status.latestVersion}`
          : `What's new in v${status.latestVersion}`,
      releases,
      fromManifest,
    };
  }
  if (aheadOfStable && status.latestVersion) {
    return {
      heading: "What you have beyond stable",
      releases: releasesBetween(entries, status.latestVersion, currentVersion),
      fromManifest: false,
    };
  }
  return { heading: "What's new", releases: [], fromManifest: false };
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
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [changelogExpanded, setChangelogExpanded] = useState(false);

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
      // The apply route re-verifies the image, so pull its verdict.
      await fetchStatus();
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

  const handleChannelChange = async (installBetas: boolean) => {
    try {
      const res = await fetch("/api/admin/updates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateChannel: installBetas ? "beta" : "stable",
        }),
      });
      if (!res.ok) throw new Error("Failed to update channel");
      await fetchStatus();
      await handleCheck();
    } catch {
      setError("Failed to change update channel");
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

  const aheadOfStable = status.runningAheadOfStable && !status.updateAvailable;
  const installable = status.updateAvailable || aheadOfStable;
  const imageReady = status.imageAvailable === true;
  const inProgress = status.history.find((h) =>
    (ACTIVE_UPDATE_STATUSES as readonly string[]).includes(h.status),
  );
  const latestRun = status.history[0];

  const heading = status.updateAvailable
    ? imageReady
      ? `Update available: v${status.latestVersion}`
      : `v${status.latestVersion} is on its way`
    : aheadOfStable
      ? "Ahead of stable"
      : "Up to date";

  const allReleases = changelog as ChangelogEntry[];
  const whatsNew = whatsNewFor(allReleases, status, versionInfo.version);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Updates</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCheck}
          disabled={checking}
          aria-label="Check for updates"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {/* Stale or unreachable updater sidecar (kurir-ios#57) */}
        {status.updater?.configured &&
          (status.updater.stale || !status.updater.reachable) && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-900/20">
              <div className="flex items-center gap-2 text-sm font-medium text-orange-800 dark:text-orange-400">
                <TriangleAlert className="h-4 w-4" />
                {status.updater.stale
                  ? "Updater sidecar is out of date"
                  : "Updater sidecar is unreachable"}
              </div>
              <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-400/80">
                {status.updater.stale
                  ? "It cannot pin release images, so an update may silently reinstall the old version. Refresh it on the server:"
                  : "Updates cannot be applied until it is running again. Start it on the server:"}
              </p>
              <code className="mt-2 block rounded bg-orange-100 px-2 py-1.5 font-mono text-xs text-orange-900 dark:bg-orange-900/40 dark:text-orange-300">
                {UPDATER_REFRESH_COMMAND}
              </code>
            </div>
          )}

        {/* Version card */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {installable ? (
                  <ArrowDownCircle className="h-4 w-4 text-blue-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                {heading}
                {installable && status.latestReleaseUrl && (
                  <a
                    href={status.latestReleaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Release notes
                  </a>
                )}
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
                {installable && (
                  <div className="flex items-center gap-1">
                    {imageReady ? (
                      <>
                        <ShieldCheck className="h-3 w-3 text-green-500" />
                        <span className="text-muted-foreground">
                          Image verified
                        </span>{" "}
                        {status.imageCheckedAt && (
                          <RelativeTime date={status.imageCheckedAt} />
                        )}
                      </>
                    ) : (
                      <>
                        <PackageSearch className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {status.imageAvailable === false
                            ? "Docker image not published yet. Usually 10-15 min after tagging."
                            : "Image availability not checked yet."}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {installable && (
              <div className="flex shrink-0 gap-2">
                {inProgress ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <StatusBadge status={inProgress.status} />
                  </div>
                ) : !imageReady ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCheck}
                      disabled={checking}
                    >
                      <RefreshCw
                        className={cn(
                          "mr-1 h-3 w-3",
                          checking && "animate-spin",
                        )}
                      />
                      Check again
                    </Button>
                    <span title="Waiting for the Docker image to be published">
                      <Button size="sm" disabled>
                        <Download className="mr-1 h-3 w-3" />
                        {aheadOfStable ? "Reinstall stable" : "Update now"}
                      </Button>
                    </span>
                  </>
                ) : !confirmUpdate ? (
                  <Button
                    size="sm"
                    onClick={() => setConfirmUpdate(true)}
                    disabled={updating}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    {aheadOfStable ? "Reinstall stable" : "Update now"}
                  </Button>
                ) : (
                  <div className="flex max-w-xs flex-col items-end gap-2">
                    <span className="text-xs text-muted-foreground text-right">
                      {aheadOfStable
                        ? "This reinstalls the latest stable image. Database migrations this version already applied are not reverted."
                        : "Are you sure?"}
                    </span>
                    <div className="flex items-center gap-2">
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
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Latest run, expandable to full history */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {historyExpanded ? "Update history" : "Latest update"}
            </h3>
            {status.history.length > 1 && (
              <ExpandToggle
                expanded={historyExpanded}
                label={`Show full history (${status.history.length})`}
                onClick={() => setHistoryExpanded((v) => !v)}
              />
            )}
          </div>
          {latestRun ? (
            <div className="space-y-2">
              {(historyExpanded ? status.history : [latestRun]).map((entry) => (
                <RunRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No updates yet</p>
          )}
        </div>

        {/* What's new, expandable to the full changelog */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {changelogExpanded ? "All versions" : whatsNew.heading}
            </div>
            {allReleases.length > 0 && (
              <ExpandToggle
                expanded={changelogExpanded}
                label={`Show all versions (${allReleases.length})`}
                onClick={() => setChangelogExpanded((v) => !v)}
              />
            )}
          </div>
          {changelogExpanded ? (
            <div className="space-y-4">
              {allReleases.map((release) => (
                <ChangelogRelease
                  key={release.version}
                  release={release}
                  currentVersion={versionInfo.version}
                />
              ))}
            </div>
          ) : whatsNew.releases.length > 0 ? (
            <div className="space-y-4">
              {whatsNew.releases.map((release) => (
                <ChangelogRelease
                  key={release.version}
                  release={release}
                  currentVersion={versionInfo.version}
                />
              ))}
              {whatsNew.fromManifest &&
                (status.latestReleaseUrl ? (
                  <a
                    href={status.latestReleaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Full notes in Release notes
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Full notes in Release notes
                  </p>
                ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {installable
                ? "No changelog entries for this range."
                : "You're on the latest version"}
            </p>
          )}
        </div>

        {/* Update settings */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Update settings
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center justify-between gap-4 sm:flex-1">
              <div>
                <p className="text-sm">Install betas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status.updateChannel === "beta"
                    ? "Following tagged versions before they are marked stable."
                    : "Following stable releases only."}
                </p>
              </div>
              <Switch
                aria-label="Install betas"
                checked={status.updateChannel === "beta"}
                disabled={checking}
                onCheckedChange={handleChannelChange}
              />
            </div>
            <div className="sm:flex-1">
              <p className="text-sm">Update mode</p>
              <div
                className="mt-2 inline-flex rounded-md bg-muted p-0.5"
                role="group"
                aria-label="Update mode"
              >
                {(["off", "notify", "auto"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleModeChange(mode)}
                    aria-pressed={status.updateMode === mode}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                      status.updateMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode === "off"
                      ? "Off"
                      : mode === "notify"
                        ? "Notify"
                        : "Auto"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.updateMode === "off" && "Update checking is disabled."}
                {status.updateMode === "notify" &&
                  "Shows available updates; you apply them."}
                {status.updateMode === "auto" &&
                  "Applies verified updates automatically."}
              </p>
            </div>
          </div>
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
