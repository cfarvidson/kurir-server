"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { deleteGroup } from "@/actions/contact-groups";
import {
  GroupEditor,
  type ContactEmailOption,
  type EditorGroup,
} from "@/components/contacts/group-editor";

interface GroupListProps {
  groups: EditorGroup[];
  contactEmailOptions: ContactEmailOption[];
}

export function GroupList({ groups, contactEmailOptions }: GroupListProps) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditorGroup | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openCreate() {
    setEditing(undefined);
    setEditorOpen(true);
  }

  function openEdit(group: EditorGroup) {
    setEditing(group);
    setEditorOpen(true);
  }

  async function handleDelete(group: EditorGroup) {
    if (!confirm(`Delete the group "${group.name}"? This can't be undone.`)) {
      return;
    }
    setDeletingId(group.id);
    try {
      await deleteGroup(group.id);
      toast.success(`Group "${group.name}" deleted`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete group");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No groups yet</p>
            <p className="text-sm text-muted-foreground">
              Create a group to email several contacts at once.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create your first group
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Users
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground/50"
                  />
                  <span className="truncate font-medium">{group.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {group.defaultTarget === "BCC" ? "Bcc" : "To"}
                  </span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {group.members.length === 0
                    ? "No members"
                    : group.members
                        .map((m) => m.name)
                        .slice(0, 4)
                        .join(", ") +
                      (group.members.length > 4
                        ? ` +${group.members.length - 4} more`
                        : "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(group)}
                className="shrink-0 rounded p-2 text-muted-foreground hover:text-foreground"
                aria-label={`Edit ${group.name}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(group)}
                disabled={deletingId === group.id}
                className="shrink-0 rounded p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
                aria-label={`Delete ${group.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editorOpen && (
        <GroupEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          group={editing}
          contactEmailOptions={contactEmailOptions}
        />
      )}
    </div>
  );
}
