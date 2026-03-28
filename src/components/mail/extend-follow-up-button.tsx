"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { extendFollowUp } from "@/actions/follow-up";
import { FollowUpPicker } from "@/components/mail/follow-up-picker";

interface ExtendFollowUpButtonProps {
  messageId: string;
  returnPath?: string;
}

export function ExtendFollowUpButton({
  messageId,
  returnPath = "/follow-up",
}: ExtendFollowUpButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleExtend = (until: Date) => {
    const diffDays = Math.ceil(
      (until.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    toast.success(`Extended to ${diffDays} day${diffDays !== 1 ? "s" : ""}`);
    // Fire-and-forget: don't block navigation on server action
    extendFollowUp(messageId, until);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  return (
    <FollowUpPicker
      onFollowUp={handleExtend}
      align="end"
      trigger={
        <button className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
          <Bell className="h-3.5 w-3.5" />
          Extend
        </button>
      }
    />
  );
}
