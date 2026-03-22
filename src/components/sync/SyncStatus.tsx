"use client";

import { cn } from "@/lib/utils";
import type { SyncStatus } from "@/hooks/useSync";

export type { SyncStatus };

export function SyncStatusIndicator({
  status,
  size = "sm",
  className,
}: {
  status: SyncStatus;
  size?: "sm" | "xs";
  className?: string;
}) {
  const statusConfig: Record<SyncStatus, string> = {
    synced: "bg-green-500",
    syncing: "bg-blue-500 animate-pulse",
    stale: "bg-amber-400",
    error: "bg-red-500",
  };

  const sizeConfig = {
    xs: "w-1.5 h-1.5",
    sm: "w-2 h-2",
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "rounded-full",
          sizeConfig[size],
          statusConfig[status],
          className,
        )}
        aria-hidden="true"
      />
      {status === "syncing" && (
        <div
          className={cn(
            "absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75",
            sizeConfig[size],
          )}
        />
      )}
    </div>
  );
}
