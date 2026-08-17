"use client";

import { useState, useTransition } from "react";
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

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SettingsBackupPanel({
  initial,
}: {
  initial: SettingsBackupState;
}) {
  const [state, setState] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const handleCadence = (cadence: SettingsBackupCadence) => {
    const previous = state.cadence;
    setState((s) => ({ ...s, cadence }));
    startTransition(async () => {
      try {
        const result = await setSettingsBackupCadence(cadence);
        setState((s) => ({ ...s, cadence, nextRunAt: result.nextRunAt }));
      } catch {
        setState((s) => ({ ...s, cadence: previous }));
        toast.error("Could not update backup schedule");
      }
    });
  };

  const handleBackupNow = () => {
    startTransition(async () => {
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
      }
    });
  };

  const handleRestore = (messageId: string) => {
    startTransition(async () => {
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
      }
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Save contacts, screening, and preferences as a dummy Sent email. After
        a fresh install, reconnect the same mailbox and restore from this list.
        Email messages are not included.
      </p>

      <div>
        <p className="text-sm font-medium">Schedule</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CADENCES.map((c) => (
            <button
              key={c.value}
              type="button"
              disabled={isPending}
              onClick={() => handleCadence(c.value)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-sm font-medium transition-colors ${
                state.cadence === c.value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
              } disabled:opacity-50`}
            >
              {c.label}
              <span className="text-xs font-normal text-muted-foreground">
                {c.hint}
              </span>
            </button>
          ))}
        </div>
        {state.cadence !== "off" && state.nextRunAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Next automatic backup {formatWhen(state.nextRunAt)}
          </p>
        )}
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleBackupNow}
        >
          Backup now
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
                    {formatWhen(backup.sentAt)}
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
                  disabled={isPending}
                  onClick={() => handleRestore(backup.messageId)}
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
