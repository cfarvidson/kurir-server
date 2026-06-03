"use client";

import { Users, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { liveMemberCount, type RecipientTarget } from "@/lib/mail/group-expansion";

export interface ComposeGroup {
  id: string;
  name: string;
  defaultTarget: "TO" | "BCC";
  members: {
    memberId: string;
    contactEmailId: string;
    email: string;
    name: string;
  }[];
}

export interface AddedGroupState {
  group: ComposeGroup;
  target: RecipientTarget;
  /** Members removed for this one send. */
  removedMemberIds: Set<string>;
}

const TARGETS: { value: RecipientTarget; label: string }[] = [
  { value: "to", label: "To" },
  { value: "cc", label: "Cc" },
  { value: "bcc", label: "Bcc" },
];

interface RecipientGroupChipProps {
  state: AddedGroupState;
  onToggleMember: (memberId: string) => void;
  onMoveTarget: (target: RecipientTarget) => void;
  onDismiss: () => void;
}

export function RecipientGroupChip({
  state,
  onToggleMember,
  onMoveTarget,
  onDismiss,
}: RecipientGroupChipProps) {
  const { group, target, removedMemberIds } = state;
  const liveCount = liveMemberCount({
    groupId: group.id,
    target,
    members: group.members,
    removedMemberIds,
  });
  const isEmpty = liveCount === 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-muted/60 py-1 pl-2 pr-1 text-sm",
        isEmpty && "opacity-50",
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-h-[28px] items-center gap-1.5 rounded-full px-1 hover:text-primary"
            aria-label={`Group ${group.name}, ${liveCount} recipients. Edit members.`}
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{group.name}</span>
            <span className="text-muted-foreground">({liveCount})</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{group.name}</span>
              <div className="flex items-center gap-1">
                {TARGETS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onMoveTarget(t.value)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs",
                      target === t.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {group.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This group has no members.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-auto">
                {group.members.map((m) => {
                  const removed = removedMemberIds.has(m.memberId);
                  return (
                    <li
                      key={m.memberId}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1",
                          removed && "text-muted-foreground line-through",
                        )}
                      >
                        <span className="truncate">{m.name}</span>{" "}
                        <span className="truncate text-xs text-muted-foreground">
                          {m.email}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleMember(m.memberId)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                        aria-label={
                          removed
                            ? `Add ${m.name} back to this email`
                            : `Remove ${m.name} from this email`
                        }
                      >
                        {removed ? (
                          <span className="text-xs">Undo</span>
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {isEmpty && (
              <p className="text-xs text-muted-foreground">
                No recipients — this group will be skipped.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={onDismiss}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove group ${group.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
