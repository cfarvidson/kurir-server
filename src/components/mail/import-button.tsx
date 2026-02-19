"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Download, Loader2, RotateCcw } from "lucide-react";

interface ImportButtonProps {
  mode?: "import" | "resync";
}

export function ImportButton({ mode = "import" }: ImportButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [triggered, setTriggered] = useState(false);
  const queryClient = useQueryClient();

  function handleImport() {
    if (mode === "resync") {
      const confirmed = window.confirm(
        "This will erase all cached mail AND sender decisions, then re-import everything from IMAP. All senders will return to the Screener. Continue?",
      );
      if (!confirmed) return;
    }

    startTransition(async () => {
      const url =
        mode === "resync"
          ? "/api/mail/sync?batchSize=200&resync=1"
          : "/api/mail/sync?batchSize=200";

      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        let message = "Failed to start sync.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) {
            message = body.error;
          }
        } catch {
          // Ignore JSON parse errors and keep generic message.
        }
        window.alert(message);
        return;
      }

      setTriggered(true);
      // Tell AutoSync to enter import mode with progress bar
      window.dispatchEvent(new CustomEvent("start-import"));
      // Invalidate the mail-sync query so AutoSync picks up the remaining count
      queryClient.invalidateQueries({ queryKey: ["mail-sync"] });
    });
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
