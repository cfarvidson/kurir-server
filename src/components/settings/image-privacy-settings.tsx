"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { setRemoteImagePolicy } from "@/actions/image-policy";
import type { RemoteImagePolicy } from "@/lib/mail/image-policy";

const OPTIONS: {
  value: RemoteImagePolicy;
  label: string;
  description: string;
  Icon: typeof ShieldCheck;
}[] = [
  {
    value: "BLOCK_ALL",
    label: "Block all remote images",
    description:
      "Most private. No remote images load until you choose to. Trackers never fire.",
    Icon: ShieldAlert,
  },
  {
    value: "BLOCK_TRACKERS",
    label: "Load images, block trackers",
    description:
      "Show normal images but strip known trackers and invisible spy pixels.",
    Icon: ShieldCheck,
  },
  {
    value: "ALLOW_ALL",
    label: "Load all remote images",
    description:
      "Show every remote image. Images are still proxied to hide your IP address.",
    Icon: ImageIcon,
  },
];

export function ImagePrivacySettings({
  initialPolicy,
}: {
  initialPolicy: RemoteImagePolicy;
}) {
  const [policy, setPolicy] = useState<RemoteImagePolicy>(initialPolicy);
  const [isPending, startTransition] = useTransition();

  function handleSelect(next: RemoteImagePolicy) {
    if (next === policy) return;
    const previous = policy;
    setPolicy(next);
    startTransition(async () => {
      try {
        await setRemoteImagePolicy(next);
      } catch {
        setPolicy(previous);
        toast.error("Couldn't update image settings. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Control how remote images in emails are loaded. Trackers (spy pixels)
        are used to tell senders when and where you opened a message.
      </p>
      <div
        role="radiogroup"
        aria-label="Remote image loading"
        className="space-y-2"
      >
        {OPTIONS.map((opt) => {
          const selected = opt.value === policy;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isPending}
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <opt.Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  selected ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
