"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { wipeAllData } from "@/actions/wipe";

export function WipeButton() {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const router = useRouter();

  function handleClick() {
    if (step === "idle") {
      setStep("confirm");
      return;
    }

    startTransition(async () => {
      await wipeAllData();
      router.push("/setup");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="destructive"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-2 h-4 w-4" />
        )}
        {isPending
          ? "Wiping..."
          : step === "confirm"
            ? "Yes, wipe everything"
            : "Wipe All Data & Start Over"}
      </Button>
      {step === "confirm" && !isPending && (
        <Button variant="ghost" size="sm" onClick={() => setStep("idle")}>
          Cancel
        </Button>
      )}
    </div>
  );
}
