"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, RotateCcw } from "lucide-react";

interface ImportButtonProps {
  mode?: "import" | "resync";
}

export function ImportButton({ mode = "import" }: ImportButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [triggered, setTriggered] = useState(false);

  function handleImport() {
    if (mode === "resync") {
      const confirmed = window.confirm(
        "This will erase all cached mail AND sender decisions, then re-import everything from IMAP. All senders will return to the Screener. Continue?",
      );
      if (!confirmed) return;

      // Resync needs to clear data first, so we await the initial request
      startTransition(async () => {
        const res = await fetch("/api/mail/sync?batchSize=200&resync=1", {
          method: "POST",
        });
        if (!res.ok) {
          let message = "Failed to start resync.";
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            // Ignore JSON parse errors
          }
          window.alert(message);
          return;
        }
        setTriggered(true);
        window.dispatchEvent(new CustomEvent("start-import"));
      });
      return;
    }

    // Regular import: just enter import mode immediately.
    // AutoSync handles all syncing — no duplicate fetch that holds the lock.
    setTriggered(true);
    window.dispatchEvent(new CustomEvent("start-import"));
  }

  return (
    <Button
      variant={mode === "resync" ? "destructive" : "outline"}
      onClick={handleImport}
      disabled={isPending || triggered}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : mode === "resync" ? (
        <RotateCcw className="mr-2 h-4 w-4" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {triggered
        ? mode === "resync"
          ? "Resync started — see progress bar"
          : "Import started — see progress bar"
        : mode === "resync"
          ? "Resync All Messages"
          : "Import All Messages"}
    </Button>
  );
}
