"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Filter, Loader2 } from "lucide-react";
import { bulkApproveOldSenders } from "@/actions/senders";

export function ScreenRecentButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      const count = await bulkApproveOldSenders(30);
      setResult(
        count === 0
          ? "No old senders to clear — all pending senders have recent messages."
          : `Auto-approved ${count} sender${count !== 1 ? "s" : ""} with no messages in the last 30 days.`,
      );
      router.refresh();
    });
  }

  return (
    <div>
      <Button variant="outline" onClick={handleClick} disabled={isPending}>
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Filter className="mr-2 h-4 w-4" />
        )}
        {isPending ? "Processing..." : "Screen recent only (30 days)"}
      </Button>
      {result && (
        <p className="mt-2 text-sm text-muted-foreground">{result}</p>
      )}
    </div>
  );
}
