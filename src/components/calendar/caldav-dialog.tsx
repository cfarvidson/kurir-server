"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { connectCalDavAction } from "@/actions/calendar";
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

const DEFAULT_URL = "https://caldav.icloud.com";

export function CalDavDialog({
  open,
  onOpenChange,
  accountId,
  initialUrl,
  initialUsername,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  initialUrl?: string | null;
  initialUsername?: string | null;
}) {
  const router = useRouter();
  const reconnect = Boolean(accountId);
  const fieldId = accountId ? `caldav-${accountId}` : "caldav";
  const [url, setUrl] = useState(initialUrl || DEFAULT_URL);
  const [username, setUsername] = useState(initialUsername || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl || DEFAULT_URL);
    setUsername(initialUsername || "");
    setPassword("");
  }, [open, initialUrl, initialUsername]);

  async function handleSave() {
    setSaving(true);
    try {
      await connectCalDavAction({ url, username, password, accountId });
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CalDAV connect failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reconnect ? "Reconnect CalDAV" : "Add CalDAV"}</DialogTitle>
          <DialogDescription>
            For iCloud, use an app-specific password at https://caldav.icloud.com.
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-username`}>Username</Label>
            <Input
              id={`${fieldId}-username`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-password`}>Password</Label>
            <Input
              id={`${fieldId}-password`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving
              ? reconnect
                ? "Reconnecting..."
                : "Connecting..."
              : reconnect
                ? "Reconnect"
                : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
