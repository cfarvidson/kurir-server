"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateDisplayName } from "@/actions/user";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

export function DisplayNameField({
  currentName,
}: {
  currentName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName || "");
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        await updateDisplayName(name.trim());
        toast.success("Display name updated");
        setEditing(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      }
    });
  };

  if (!editing) {
    return (
      <div className="flex justify-between items-center">
        <dt className="text-sm text-muted-foreground">Display name</dt>
        <dd className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {currentName || "Not set"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </dd>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center gap-2">
      <dt className="text-sm text-muted-foreground">Display name</dt>
      <dd className="flex items-center gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-sm w-40"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={isPending || !name.trim()}
          onClick={handleSave}
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </Button>
      </dd>
    </div>
  );
}
