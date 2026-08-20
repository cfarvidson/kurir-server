"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Ban, Clock, Loader2, Mail, X } from "lucide-react";
import {
  archiveConversations,
  unarchiveConversations,
} from "@/actions/archive";
import { snoozeConversations } from "@/actions/snooze";
import { setConversationsRead } from "@/actions/read-status";
import { rejectSenders } from "@/actions/senders";
import { SnoozePicker } from "@/components/mail/snooze-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  bulkReadMarksRead,
  uniqueBlockSenderIds,
} from "@/lib/mail/list-contract";

export type SelectionRow = {
  isRead: boolean;
  senderId: string | null;
  fromAddress: string;
  senderName?: string | null;
};

type BlockConfirm =
  | { kind: "senders"; count: number; ids: string[] }
  | { kind: "messages"; count: number; ids: string[]; name: string };

interface SelectionActionBarProps {
  selectedMessageIds: string[];
  onComplete: () => void;
  onQueryInvalidate: (messageIds?: string | string[]) => void;
  showSnoozeAction?: boolean;
  showArchiveAction?: boolean;
  showUnarchiveAction?: boolean;
  showReadAction?: boolean;
  showBlockAction?: boolean;
  readLabel?: string;
  selectedRows?: SelectionRow[];
  isOwn?: (email: string) => boolean;
  onRead?: (messageIds: string[], isRead: boolean) => void;
  onBlocked?: (senderIds: string[]) => void;
  sourcePath?: string;
}

export function SelectionActionBar({
  selectedMessageIds,
  onComplete,
  onQueryInvalidate,
  showSnoozeAction = false,
  showArchiveAction = true,
  showUnarchiveAction = false,
  showReadAction = false,
  showBlockAction = false,
  readLabel,
  selectedRows,
  isOwn,
  onRead,
  onBlocked,
  sourcePath,
}: SelectionActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<BlockConfirm | null>(null);
  const count = selectedMessageIds.length;

  const resolvedReadLabel =
    readLabel ??
    (selectedRows && selectedRows.length > 0
      ? bulkReadMarksRead(selectedRows)
        ? "Read"
        : "Unread"
      : "Read");

  const isOwnFn = isOwn ?? (() => false);
  const blockIds = uniqueBlockSenderIds(selectedRows ?? [], isOwnFn);
  const canBlock =
    showBlockAction && (selectedRows === undefined || blockIds.length > 0);

  if (count === 0) return null;

  const handleArchive = () => {
    const idsToArchive = [...selectedMessageIds];
    startTransition(async () => {
      await archiveConversations(idsToArchive, sourcePath);
      onQueryInvalidate(idsToArchive);
      onComplete();
    });
  };

  const handleUnarchive = () => {
    const idsToUnarchive = [...selectedMessageIds];
    startTransition(async () => {
      await unarchiveConversations(idsToUnarchive);
      onQueryInvalidate(idsToUnarchive);
      onComplete();
    });
  };

  const handleSnooze = (until: Date) => {
    const idsToSnooze = [...selectedMessageIds];
    startTransition(async () => {
      await snoozeConversations(idsToSnooze, until);
      onQueryInvalidate(idsToSnooze);
      onComplete();
    });
  };

  const handleRead = () => {
    const idsToRead = [...selectedMessageIds];
    const isRead = resolvedReadLabel === "Read";
    startTransition(async () => {
      await setConversationsRead(idsToRead, isRead);
      onRead?.(idsToRead, isRead);
      onComplete();
    });
  };

  const runReject = (ids: string[], confirmed: boolean) => {
    startTransition(async () => {
      const result = await rejectSenders(
        ids,
        confirmed ? { confirmed: true } : undefined,
      );
      if (result?.needsConfirm) {
        const row = selectedRows?.find((r) => r.senderId === ids[0]);
        const name =
          row?.senderName?.trim() || row?.fromAddress || "this sender";
        setConfirm({
          kind: "messages",
          count: result.count,
          ids,
          name,
        });
        return;
      }
      onBlocked?.(ids);
      onComplete();
    });
  };

  const handleBlock = () => {
    if (blockIds.length === 0) return;
    if (blockIds.length >= 2) {
      setConfirm({ kind: "senders", count: blockIds.length, ids: blockIds });
      return;
    }
    runReject(blockIds, false);
  };

  const handleConfirmBlock = () => {
    if (!confirm) return;
    const ids = confirm.ids;
    setConfirm(null);
    runReject(ids, true);
  };

  return (
    <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2.5 shadow-overlay backdrop-blur-sm supports-backdrop-filter:bg-background/80">
        <span className="text-sm tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{count}</span>{" "}
          {count === 1 ? "conversation" : "conversations"} selected
        </span>
        {showSnoozeAction && (
          <SnoozePicker
            onSnooze={handleSnooze}
            isPending={isPending}
            side="top"
            align="center"
            trigger={
              <button
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                Snooze
              </button>
            }
          />
        )}
        {showUnarchiveAction ? (
          <button
            onClick={handleUnarchive}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArchiveRestore className="h-4 w-4" />
            )}
            Unarchive
          </button>
        ) : showArchiveAction ? (
          <button
            onClick={handleArchive}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            Archive
          </button>
        ) : null}
        {showReadAction && (
          <button
            onClick={handleRead}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {resolvedReadLabel}
          </button>
        )}
        {canBlock && (
          <button
            onClick={handleBlock}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            Block sender
          </button>
        )}
        <button
          onClick={onComplete}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Cancel selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "senders"
                ? `Block ${confirm.count} senders?`
                : confirm
                  ? `Block ${confirm.count} messages from ${confirm.name}?`
                  : ""}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmBlock}
              className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              Block sender
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
