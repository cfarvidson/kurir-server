"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";

export function ImportButton() {
  const [isPending, startTransition] = useTransition();
  const [triggered, setTriggered] = useState(false);
  const queryClient = useQueryClient();

  function handleImport() {
    startTransition(async () => {
      await fetch("/api/mail/sync?batchSize=200", { method: "POST" });
      setTriggered(true);
      // Invalidate the mail-sync query so AutoSync picks up the remaining count
      queryClient.invalidateQueries({ queryKey: ["mail-sync"] });
    });
  }

  return (
    <Button
      variant="outline"
      onClick={handleImport}
      disabled={isPending || triggered}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {triggered ? "Import started — see progress bar" : "Import All Messages"}
    </Button>
  );
}
