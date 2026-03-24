"use client";

import { cn } from "@/lib/utils";
import type { SyncStatus } from "@/hooks/useSync";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type { SyncStatus };

function formatRelativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function getTooltipText(
  status: SyncStatus,
  lastSyncTime?: Date | null,
  errorMessage?: string,
): string {
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "error":
      return errorMessage ? `Sync error — ${errorMessage}` : "Sync error";
    case "stale":
      if (errorMessage) return errorMessage;
      return lastSyncTime
        ? `Sync delayed — last sync ${formatRelativeTime(lastSyncTime)}`
        : "Sync delayed";
    case "synced":
      return lastSyncTime
        ? `Synced — ${formatRelativeTime(lastSyncTime)}`
        : "Synced";
  }
}

export function SyncStatusIndicator({
  status,
  lastSyncTime,
  errorMessage,
  size = "sm",
  className,
}: {
  status: SyncStatus;
  lastSyncTime?: Date | null;
  errorMessage?: string;
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
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("relative cursor-default", className)}>
            <div
              className={cn(
                "rounded-full",
                sizeConfig[size],
                statusConfig[status],
              )}
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
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{getTooltipText(status, lastSyncTime, errorMessage)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
