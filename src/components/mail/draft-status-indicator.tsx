"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DraftStatus = "idle" | "saving" | "saved" | "error";

interface DraftStatusIndicatorProps {
  status: DraftStatus;
}

export function DraftStatusIndicator({ status }: DraftStatusIndicatorProps) {
  if (status === "idle") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "animate-fade-out text-muted-foreground",
        status === "error" && "text-amber-500",
      )}
    >
      {status === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </>
      )}
      {status === "saved" && (
        <>
          <Cloud className="h-3 w-3" />
          Saved
        </>
      )}
      {status === "error" && (
        <>
          <CloudOff className="h-3 w-3" />
          Saved locally
        </>
      )}
    </span>
  );
}
