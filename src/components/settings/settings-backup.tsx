"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  backupSettingsNow,
  getSettingsBackupState,
  restoreSettingsBackup,
  setSettingsBackupCadence,
  type SettingsBackupState,
} from "@/actions/settings-backup";
import type { SettingsBackupCadence } from "@/lib/mail/settings-backup-cadence";

const CADENCES: { value: SettingsBackupCadence; label: string; hint: string }[] =
  [
    { value: "off", label: "Off", hint: "No automatic copy" },
    { value: "daily", label: "Daily", hint: "03:00 local" },
    { value: "weekly", label: "Weekly", hint: "Same weekday, 03:00" },
  ];

function formatWhen(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function SettingsBackupPanel({
  initial,
}: {
  initial: SettingsBackupState;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<"cadence" | "backup" | "restore" | null>(
    null,
  );

  const handleCadence = async (cadence: SettingsBackupCadence) => {
    if (cadence === state.cadence || busy) return;
    const previous = state;
    setState((s) => ({
      ...s,
      cadence,
      nextRunAt: cadence === "off" ? null : s.nextRunAt,
    }));
    setBusy("cadence");
    try {
      const result = await setSettingsBackupCadence(cadence);
      setState((s) => ({ ...s, cadence, nextRunAt: result.nextRunAt }));
    } catch {
      setState(previous);
      toast.error("Could not update backup schedule");
    } finally {
      setBusy(null);
    }
  };

  const handleBackupNow = async () => {
    if (busy) return;
    setBusy("backup");
    try {
      const result = await backupSettingsNow();
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Settings backup saved to Sent");
      }
      const next = await getSettingsBackupState();
      setState(next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not write backup",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (messageId: string) => {
    if (busy) return;
    setBusy("restore");
    try {
      const result = await restoreSettingsBackup(messageId);
      if (result.skippedConnections.length > 0) {
        toast.success(
          `Restored. Skipped ${result.skippedConnections.join(", ")}`,
        );
      } else {
        toast.success("Settings restored");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not restore backup",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium">Schedule</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CADENCES.map((c) => {
            const selected = state.cadence === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={selected}
                disabled={busy === "cadence"}
                onClick={() => void handleCadence(c.value)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-sm font-medium transition-colors ${
                  selected
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                }`}
              >
                {c.label}
                <span className="text-xs font-normal text-muted-foreground">
                  {c.hint}
                </span>
              </button>
            );
          })}
        </div>
        {state.cadence !== "off" && state.nextRunAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Next automatic backup{" "}
            {formatWhen(state.nextRunAt, state.timezone)}
          </p>
        )}
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={busy === "backup"}
          onClick={() => void handleBackupNow()}
        >
          {busy === "backup" ? "Saving…" : "Backup now"}
        </Button>
      </div>

      <div>
        <p className="text-sm font-medium">Saved copies</p>
        {state.backups.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No settings backups in Sent yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {state.backups.map((backup) => (
              <li
                key={backup.messageId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {formatWhen(backup.sentAt, state.timezone)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {backup.source === "scheduled" ? "Scheduled" : "Manual"}
                    {" · "}
                    {backup.filename}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === "restore"}
                  onClick={() => void handleRestore(backup.messageId)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
