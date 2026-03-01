"use client";

/**
 * PasskeyCard — shows one registered passkey in the settings page.
 * Displays device name, creation date, and allows deletion.
 */

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Fingerprint, Trash2, Loader2, Monitor, Smartphone } from "lucide-react";

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
  /** Prevent deleting if this is the only passkey */
  isOnly: boolean;
}

export function PasskeyCard({ passkey, onDelete, isOnly }: PasskeyCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      await onDelete(passkey.id);
      setShowConfirm(false);
    });
  };

  const DeviceIcon =
    passkey.deviceType === "multiDevice" ? Smartphone : Monitor;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Fingerprint className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <DeviceIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-sm font-medium">{passkey.friendlyName}</p>
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
              <p className="text-sm text-destructive font-medium">
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
