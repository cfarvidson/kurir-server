"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Clock, Bell, CornerDownLeft } from "lucide-react";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import { snoozeConversation } from "@/actions/snooze";
import { setFollowUp } from "@/actions/follow-up";
import { showUndoToast } from "@/components/mail/undo-toast";
import { SnoozePicker } from "@/components/mail/snooze-picker";
import { FollowUpPicker } from "@/components/mail/follow-up-picker";
import { cn } from "@/lib/utils";

interface MobileThreadActionsProps {
  messageId: string;
  returnPath: string;
  timezone?: string;
  showArchive?: boolean;
  showSnooze?: boolean;
  showFollowUp?: boolean;
}

export function MobileThreadActions({
  messageId,
  returnPath,
  timezone = "UTC",
  showArchive = true,
  showSnooze = true,
  showFollowUp = true,
}: MobileThreadActionsProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleArchive = async () => {
    showUndoToast({
      id: `archive-${messageId}`,
      label: "Archived",
      onUndo: () => {
        unarchiveConversation(messageId).then(() => router.refresh());
      },
    });
    await archiveConversation(messageId, returnPath);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  const handleSnooze = async (until: Date) => {
    await snoozeConversation(messageId, until);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  const scrollToReply = () => {
    // Scroll to reply composer and focus it
    const replyButton = document.querySelector<HTMLButtonElement>(
      "[data-reply-composer-trigger]",
    );
    if (replyButton) {
      replyButton.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => replyButton.click(), 300);
    }
  };

  const buttonBase =
    "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors active:bg-muted";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card/95 backdrop-blur-xs pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-stretch">
        <button
          onClick={scrollToReply}
          className={cn(buttonBase, "text-primary")}
        >
          <CornerDownLeft className="h-5 w-5" />
          <span>Reply</span>
        </button>

        {showFollowUp && (
          <FollowUpPicker
            onFollowUp={async (until) => {
              await setFollowUp(messageId, until);
              router.refresh();
            }}
            align="center"
            side="top"
            trigger={
              <button className={cn(buttonBase, "text-muted-foreground")}>
                <Bell className="h-5 w-5" />
                <span>Follow Up</span>
              </button>
            }
          />
        )}

        {showSnooze && (
          <SnoozePicker
            onSnooze={handleSnooze}
            timezone={timezone}
            align="center"
            side="top"
            trigger={
              <button className={cn(buttonBase, "text-muted-foreground")}>
                <Clock className="h-5 w-5" />
                <span>Snooze</span>
              </button>
            }
          />
        )}

        {showArchive && (
          <button
            onClick={handleArchive}
            className={cn(buttonBase, "text-muted-foreground")}
          >
            <Archive className="h-5 w-5" />
            <span>Archive</span>
          </button>
        )}
      </div>
    </div>
  );
}
