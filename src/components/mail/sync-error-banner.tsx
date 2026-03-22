"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useSync } from "@/hooks/useSync";
import { cn } from "@/lib/utils";

export function SyncErrorBanner() {
  const { status, errorMessage, retry, retrying } = useSync();

  if (status !== "error" && status !== "stale") return null;

  const isError = status === "error";

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2.5 text-sm md:px-6",
        isError
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">
        {isError
          ? `Sync error: ${errorMessage || "Unable to sync emails"}`
          : (errorMessage || "Email sync is delayed")}
      </span>
      <button
        onClick={retry}
        disabled={retrying}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
          isError
            ? "bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800"
            : "bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800",
        )}
      >
        <RefreshCw
          className={cn("h-3 w-3", retrying && "animate-spin")}
        />
        {retrying ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}
