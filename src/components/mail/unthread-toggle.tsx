"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, GitBranchPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setSenderUnthread } from "@/actions/senders";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface UnthreadToggleProps {
  senderId: string;
  senderLabel: string;
  unthread: boolean;
}

export function UnthreadToggle({
  senderId,
  senderLabel,
  unthread,
}: UnthreadToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    const next = !unthread;
    startTransition(async () => {
      try {
        await setSenderUnthread(senderId, next);
        setOpen(false);
        toast.success(
          next
            ? `Emails from ${senderLabel} will no longer be grouped`
            : `Emails from ${senderLabel} will be grouped into threads`,
        );
        router.refresh();
      } catch (err) {
        console.error(err);
        toast.error("Could not update threading preference");
      }
    });
  };

  const Icon = unthread ? GitBranchPlus : GitBranch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unthread ? "Thread emails from this sender" : "Don't thread emails"
          }
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            unthread && "text-primary",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">
              {unthread
                ? "Re-thread emails"
                : "Don't thread emails from this sender"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {unthread
                ? `Group future and past emails from ${senderLabel} into threads again.`
                : `Each email from ${senderLabel} will appear as its own row instead of being collapsed into a thread.`}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={isPending}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50",
            )}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {unthread ? "Re-thread emails" : "Don't thread"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
