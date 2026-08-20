"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SquarePen, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DraftType } from "@prisma/client";
import { deleteDraft } from "@/actions/drafts";
import { clearDraftInLocalStorage } from "@/hooks/use-draft";
import { formatDistanceToNow } from "@/lib/date";
import { EmptyState } from "@/components/mail/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DraftListItem {
  type: DraftType;
  contextMessageId: string;
  to: string;
  subject: string;
  snippet: string;
  updatedAt: string; // ISO string
  href: string;
  displayFrom?: string | null;
}

export function draftTypeLabel(type: DraftType | string): string {
  if (type === "REPLY") return "Reply";
  if (type === "FORWARD") return "Forward";
  return "New";
}

export function draftRecipientLine(to: string): string {
  const trimmed = to.trim();
  return trimmed ? `To: ${trimmed}` : "No recipient";
}

export function draftPrimaryLine(draft: {
  type: string;
  to: string;
  displayFrom?: string | null;
}): string {
  if (draft.type === "REPLY" && draft.displayFrom?.trim()) {
    return draft.displayFrom.trim();
  }
  return draftRecipientLine(draft.to);
}

export function draftSubjectLine(subject: string): string {
  const trimmed = subject.trim();
  return trimmed || "(no subject)";
}

export function DraftsList({
  drafts,
  userId,
}: {
  drafts: DraftListItem[];
  userId: string;
}) {
  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={<SquarePen />}
        title="No drafts"
        description="Mail you start writing shows up here."
      />
    );
  }

  return (
    <div>
      {drafts.map((draft) => (
        <DraftRow
          key={`${draft.type}_${draft.contextMessageId}`}
          draft={draft}
          userId={userId}
        />
      ))}
    </div>
  );
}

function DraftRow({ draft, userId }: { draft: DraftListItem; userId: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const subject = draftSubjectLine(draft.subject);

  const handleDelete = () => {
    startDeleteTransition(async () => {
      clearDraftInLocalStorage(userId, draft.type, draft.contextMessageId);
      try {
        await deleteDraft(draft.type, draft.contextMessageId);
        toast.success("Draft deleted");
        setConfirmOpen(false);
        router.refresh();
      } catch {
        toast.error("Failed to delete draft");
      }
    });
  };

  return (
    <div className="group relative flex items-start gap-4 border-b border-border px-4 py-3 md:gap-5 md:px-6 md:py-4">
      <Link
        href={draft.href}
        className="min-w-0 flex-1 rounded-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex items-baseline gap-2">
          <span className="eyebrow text-muted-foreground">
            {draftTypeLabel(draft.type)}
          </span>
          <span
            className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDistanceToNow(new Date(draft.updatedAt))}
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-medium text-foreground">
          {draftPrimaryLine(draft)}
        </div>
        <div className="truncate text-[0.9375rem] text-muted-foreground">
          {subject}
        </div>
        {draft.snippet && (
          <div className="mt-0.5 line-clamp-2 text-[0.8125rem] text-muted-foreground">
            {draft.snippet}
          </div>
        )}
      </Link>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={isDeleting}
        aria-label={`Delete draft ${subject}`}
        className="-mt-0.5 shrink-0 self-start text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 />
        Delete
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              “{subject}” will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete draft"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
