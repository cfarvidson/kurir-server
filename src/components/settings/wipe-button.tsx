"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { wipeAllData, wipeMailData } from "@/actions/wipe";

function ConfirmButton({
  label,
  confirmLabel,
  pendingLabel,
  icon: Icon,
  onConfirm,
  redirect,
}: {
  label: string;
  confirmLabel: string;
  pendingLabel: string;
  icon: typeof Trash2;
  onConfirm: () => Promise<unknown>;
  redirect?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const router = useRouter();

  function handleClick() {
    if (step === "idle") {
      setStep("confirm");
      return;
    }

    startTransition(async () => {
      await onConfirm();
      if (redirect) {
        router.push(redirect);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={step === "confirm" ? "destructive" : "outline"}
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          step !== "confirm" &&
            "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Icon className="mr-2 h-4 w-4" />
        )}
        {isPending ? pendingLabel : step === "confirm" ? confirmLabel : label}
      </Button>
      {step === "confirm" && !isPending && (
        <Button variant="ghost" size="sm" onClick={() => setStep("idle")}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function WipeMailButton() {
  return (
    <ConfirmButton
      label="Clear All Messages"
      confirmLabel="Yes, clear all messages"
      pendingLabel="Clearing..."
      icon={Eraser}
      onConfirm={wipeMailData}
    />
  );
}

export function WipeButton() {
  return (
    <ConfirmButton
      label="Wipe All Data & Start Over"
      confirmLabel="Yes, wipe everything"
      pendingLabel="Wiping..."
      icon={Trash2}
      onConfirm={wipeAllData}
      redirect="/setup"
    />
  );
}
