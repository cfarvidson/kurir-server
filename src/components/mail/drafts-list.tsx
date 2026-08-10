"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SquarePen, Reply, Forward, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DraftType } from "@prisma/client";
import { deleteDraft } from "@/actions/drafts";
import { clearDraftInLocalStorage } from "@/hooks/use-draft";
import { EmptyState } from "@/components/mail/empty-state";

export interface DraftListItem {
  type: DraftType;
  contextMessageId: string;
  to: string;
  subject: string;
  snippet: string;
  updatedAt: string; // ISO string
  href: string;
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
    <div className="divide-y">
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
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = (e: React.MouseEvent) => {
    // The whole row is a link - the delete button must not navigate.
    e.preventDefault();
    startDeleteTransition(async () => {
      clearDraftInLocalStorage(userId, draft.type, draft.contextMessageId);
      try {
        await deleteDraft(draft.type, draft.contextMessageId);
        toast.success("Draft deleted");
        router.refresh();
      } catch {
        toast.error("Failed to delete draft");
      }
    });
  };

  return (
    <Link
      href={draft.href}
      className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/40 md:px-6"
    >
      {/* Type indicator */}
      <div className="mt-1 shrink-0">
        {draft.type === "REPLY" ? (
          <Reply className="h-4 w-4 text-muted-foreground" />
        ) : draft.type === "FORWARD" ? (
          <Forward className="h-4 w-4 text-muted-foreground" />
        ) : (
          <SquarePen className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {draft.to ? `To: ${draft.to}` : "No recipient"}
          </span>
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {relativeTime(draft.updatedAt)}
          </span>
        </div>

        <div className="truncate text-sm text-foreground/80">
          {draft.subject || "(no subject)"}
        </div>

        {draft.snippet && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {draft.snippet}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center">
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          title="Delete draft"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {isDeleting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>
    </Link>
  );
}

/** Relative "last edited" time: "just now", "12m ago", "3h ago", else date. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
