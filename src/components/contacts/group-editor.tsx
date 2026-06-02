"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Search, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createGroup,
  renameGroup,
  setGroupDefaultTarget,
  addGroupMember,
  removeGroupMember,
} from "@/actions/contact-groups";

export interface ContactEmailOption {
  contactEmailId: string;
  email: string;
  name: string;
}

interface EditorMember {
  contactEmailId: string;
  email: string;
  name: string;
  /** Present when this member already exists on the saved group. */
  memberId?: string;
}

export interface EditorGroup {
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

interface GroupEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined = create mode. */
  group?: EditorGroup;
  contactEmailOptions: ContactEmailOption[];
}

export function GroupEditor({
  open,
  onOpenChange,
  group,
  contactEmailOptions,
}: GroupEditorProps) {
  const router = useRouter();
  const isEdit = !!group;

  const [name, setName] = useState(group?.name ?? "");
  const [target, setTarget] = useState<"TO" | "BCC">(
    group?.defaultTarget ?? "TO",
  );
  const [members, setMembers] = useState<EditorMember[]>(
    group?.members.map((m) => ({
      contactEmailId: m.contactEmailId,
      email: m.email,
      name: m.name,
      memberId: m.memberId,
    })) ?? [],
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addedIds = useMemo(
    () => new Set(members.map((m) => m.contactEmailId)),
    [members],
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contactEmailOptions
      .filter((o) => !addedIds.has(o.contactEmailId))
      .filter(
        (o) =>
          !q ||
          o.name.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [contactEmailOptions, addedIds, search]);

  function addMember(option: ContactEmailOption) {
    setMembers((prev) => [...prev, { ...option }]);
    setSearch("");
  }

  function removeMember(contactEmailId: string) {
    setMembers((prev) =>
      prev.filter((m) => m.contactEmailId !== contactEmailId),
    );
  }

  async function persistEdit(g: EditorGroup) {
    if (name.trim() !== g.name) {
      await renameGroup(g.id, name.trim());
    }
    if (target !== g.defaultTarget) {
      await setGroupDefaultTarget(g.id, target);
    }
    const originalByEmailId = new Map(
      g.members.map((m) => [m.contactEmailId, m]),
    );
    const currentIds = new Set(members.map((m) => m.contactEmailId));

    // Added members (present now, absent originally)
    for (const m of members) {
      if (!originalByEmailId.has(m.contactEmailId)) {
        await addGroupMember(g.id, m.contactEmailId);
      }
    }
    // Removed members (present originally, absent now)
    for (const m of g.members) {
      if (!currentIds.has(m.contactEmailId)) {
        await removeGroupMember(m.memberId);
      }
    }
  }

  async function handleSave() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    try {
      if (isEdit && group) {
        await persistEdit(group);
        toast.success("Group updated");
      } else {
        await createGroup({
          name: trimmed,
          defaultTarget: target,
          memberContactEmailIds: members.map((m) => m.contactEmailId),
        });
        toast.success(`Group "${trimmed}" created`);
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save group");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit group" : "New group"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              placeholder="Family"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Default field</Label>
            <div className="flex items-center gap-2">
              {(["TO", "BCC"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm",
                    target === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted/60",
                  )}
                >
                  {t === "TO" ? "To" : "Bcc"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Where this group lands when added to an email. You can still
              move it per message.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Members ({members.length})</Label>
            {members.length > 0 && (
              <ul className="space-y-1">
                {members.map((m) => (
                  <li
                    key={m.contactEmailId}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.name}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {m.email}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMember(m.contactEmailId)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${m.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Add a contact..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
              {search.trim() && filteredOptions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg">
                  {filteredOptions.map((o) => (
                    <button
                      key={o.contactEmailId}
                      type="button"
                      onClick={() => addMember(o)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{o.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {o.email}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {members.length === 0 && (
            <p className="text-xs text-muted-foreground">
              An empty group sends to no one until you add members.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
