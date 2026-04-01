"use client";

import { useState, useCallback } from "react";
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
import { createContact } from "@/actions/contacts";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

interface EmailRow {
  id: string;
  email: string;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

let nextId = 0;
function makeId() {
  return `email-row-${++nextId}`;
}

function freshRow(): EmailRow {
  return { id: makeId(), email: "" };
}

export function AddContactDialog({
  open,
  onOpenChange,
}: AddContactDialogProps) {
  const [name, setName] = useState("");
  const [emailRows, setEmailRows] = useState<EmailRow[]>(() => [freshRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setName("");
    setEmailRows([freshRow()]);
    setError(null);
    setSaving(false);
  }, []);

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  function updateEmail(id: string, value: string) {
    setEmailRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, email: value } : r)),
    );
  }

  function addRow() {
    setEmailRows((rows) => [...rows, freshRow()]);
  }

  function removeRow(id: string) {
    setEmailRows((rows) => rows.filter((r) => r.id !== id));
  }

  async function handleSave() {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }

    const validEmails = emailRows.filter((r) => r.email.trim() !== "");
    if (validEmails.length === 0) {
      setError("At least one email is required");
      return;
    }

    setSaving(true);
    try {
      await createContact({
        name: trimmedName,
        emails: validEmails.map((r) => ({
          email: r.email.trim(),
          label: "personal",
        })),
      });
      toast.success(`${trimmedName} added to contacts`);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Email rows */}
          <div className="space-y-2">
            <Label>Email addresses</Label>
            <div className="space-y-2">
              {emailRows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    type="email"
                    placeholder="jane@example.com"
                    value={row.email}
                    onChange={(e) => updateEmail(row.id, e.target.value)}
                    className="flex-1"
                  />
                  {emailRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add another email
            </button>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
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
