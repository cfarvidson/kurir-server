"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Fingerprint,
  Trash2,
  Loader2,
  Monitor,
  Smartphone,
  Pencil,
} from "lucide-react";

export interface PasskeyInfo {
  id: string;
  friendlyName: string;
  createdAt: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
}

interface PasskeyCardProps {
  passkey: PasskeyInfo;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  isOnly: boolean;
}

export function PasskeyCard({
  passkey,
  onDelete,
  onRename,
  isOnly,
}: PasskeyCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(passkey.friendlyName);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleDelete = () => {
    startTransition(async () => {
      await onDelete(passkey.id);
      setShowConfirm(false);
    });
  };

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === passkey.friendlyName) {
      setIsEditing(false);
      setEditName(passkey.friendlyName);
      return;
    }
    startTransition(async () => {
      await onRename(passkey.id, trimmed);
      setIsEditing(false);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditName(passkey.friendlyName);
    }
  };

  const DeviceIcon =
    passkey.deviceType === "multiDevice" ? Smartphone : Monitor;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Fingerprint className="h-4 w-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DeviceIcon className="h-3.5 w-3.5 text-muted-foreground" />
            {isEditing ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleRenameSubmit}
                  maxLength={100}
                  className="h-6 w-40 rounded border bg-background px-1.5 text-sm font-medium outline-hidden focus:ring-1 focus:ring-ring"
                  disabled={isPending}
                />
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditName(passkey.friendlyName);
                  setIsEditing(true);
                }}
                className="group/rename flex items-center gap-1 text-sm font-medium"
                title="Rename passkey"
              >
                {passkey.friendlyName}
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/rename:opacity-100" />
              </button>
            )}
            {passkey.backedUp && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                Synced
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Added {new Date(passkey.createdAt).toLocaleDateString()}
          </p>
        </div>

        {!isOnly && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
            title="Remove this passkey"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium text-destructive">
                Remove &ldquo;{passkey.friendlyName}&rdquo;?
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You won&apos;t be able to use this device to sign in anymore.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Remove"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowConfirm(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
