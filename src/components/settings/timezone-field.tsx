"use client";

import { useMemo, useState, useTransition } from "react";
import { updateTimezone } from "@/actions/user";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Profile row for the account timezone. Every calendar surface, snooze
 * time and scheduled send is drawn in this zone, so it lives with the
 * other identity fields. Saves on change, like the theme picker.
 */
export function TimezoneField({ current }: { current: string | null }) {
  const [zone, setZone] = useState(current);
  const [isPending, startTransition] = useTransition();

  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    // The stored zone can predate the browser's list (or be plain "UTC",
    // which supportedValuesOf omits) - keep it selectable either way.
    return zone && !all.includes(zone) ? [zone, ...all] : all;
  }, [zone]);

  const handleChange = (value: string) => {
    const previous = zone;
    setZone(value);
    startTransition(async () => {
      try {
        await updateTimezone(value);
        toast.success("Timezone updated");
      } catch {
        setZone(previous);
        toast.error("Failed to update timezone");
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-sm text-muted-foreground">Timezone</dt>
      <dd className="flex items-center gap-2">
        {isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <select
          value={zone ?? ""}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.value)}
          className="h-7 max-w-56 rounded-md border border-border bg-transparent px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {/* An account that has not adopted a zone yet reads as UTC
              everywhere, so name that state instead of showing a blank. */}
          {!zone && <option value="">UTC (not set)</option>}
          {zones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}
