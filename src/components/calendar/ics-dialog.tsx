"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { connectIcsAction } from "@/actions/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function IcsDialog({
  open,
  onOpenChange,
  accountId,
  initialUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  initialUrl?: string | null;
}) {
  const router = useRouter();
  const reconnect = Boolean(accountId);
  const fieldId = accountId ? `ics-${accountId}` : "ics";
  const [url, setUrl] = useState(initialUrl || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl || "");
  }, [open, initialUrl]);

  async function handleSave() {
    setSaving(true);
    try {
      await connectIcsAction({ url, accountId });
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Calendar URL subscribe failed",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {reconnect ? "Reconnect calendar URL" : "Add calendar URL"}
          </DialogTitle>
          <DialogDescription>
            A public calendar URL. No username or password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-url`}>URL</Label>
            <Input
              id={`${fieldId}-url`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="url"
              placeholder="https://example.com/calendar.ics"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !url.trim()}>
            {saving
              ? reconnect
                ? "Reconnecting..."
                : "Subscribing..."
              : reconnect
                ? "Reconnect"
                : "Subscribe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
