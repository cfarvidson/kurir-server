"use client";

/**
 * EmailConnectionCard — shows one email connection in the settings page.
 * Displays connection info, sync status, default badge, and an overflow action menu.
 *
 * Per UX spec: remove action is inside overflow menu to prevent accidental taps.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Mail,
  Star,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Server,
  MoreHorizontal,
  Trash2,
  StarOff,
} from "lucide-react";

export interface EmailConnection {
  id: string;
  email: string;
  displayName: string | null;
  imapHost: string;
  smtpHost: string;
  isDefault: boolean;
  createdAt: string;
  syncStatus?: "synced" | "syncing" | "error" | "idle";
  lastSyncedAt?: string | null;
}

interface ConnectionCardProps {
  connection: EmailConnection;
  onSetDefault: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSync: (id: string) => Promise<void>;
  /** Prevent deleting if this is the last connection */
  isOnly: boolean;
}

export function ConnectionCard({
  connection,
  onSetDefault,
  onDelete,
  onSync,
  isOnly,
}: ConnectionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState<
    "idle" | "setting-default" | "syncing" | "deleting"
  >("idle");
  const menuRef = useRef<HTMLDivElement>(null);

  const isBusy = isPending || localStatus !== "idle";

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleSetDefault = () => {
    if (connection.isDefault) return;
    setMenuOpen(false);
    setLocalStatus("setting-default");
    startTransition(async () => {
      await onSetDefault(connection.id);
      setLocalStatus("idle");
    });
  };

  const handleSync = () => {
    setLocalStatus("syncing");
    startTransition(async () => {
      await onSync(connection.id);
      setLocalStatus("idle");
    });
  };

  const handleDeleteConfirm = () => {
    setLocalStatus("deleting");
    startTransition(async () => {
      await onDelete(connection.id);
      setLocalStatus("idle");
      setShowDeleteConfirm(false);
    });
  };

  const statusIcon = () => {
    if (localStatus === "syncing" || connection.syncStatus === "syncing") {
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    }
    if (connection.syncStatus === "error") {
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    }
    if (connection.syncStatus === "synced") {
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    }
    return null;
  };

  const statusLabel = () => {
    if (localStatus === "syncing") return "Syncing...";
    if (connection.syncStatus === "syncing") return "Syncing...";
    if (connection.syncStatus === "error") return "Sync error";
    if (connection.syncStatus === "synced" && connection.lastSyncedAt) {
      return `Synced ${new Date(connection.lastSyncedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    return "Not yet synced";
  };

  return (
    <article
      aria-label={`Email connection: ${connection.email}`}
      className={cn(
        "rounded-lg border bg-card transition-shadow",
        connection.isDefault && "ring-1 ring-primary/20"
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Email avatar */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-4 w-4 text-primary" />
        </div>

        {/* Connection info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">
              {connection.displayName || connection.email}
            </p>
            {connection.isDefault && (
              <span className="inline-flex items-center rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary/80">
                Default
              </span>
            )}
          </div>
          {connection.displayName && (
            <p className="text-xs text-muted-foreground truncate">
              {connection.email}
            </p>
          )}

          {/* Sync status */}
          <div className="mt-1 flex items-center gap-1.5">
            {statusIcon()}
            <span className="text-xs text-muted-foreground">{statusLabel()}</span>
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Quick sync button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSync}
            disabled={isBusy}
            title="Sync this connection now"
            className="h-8 w-8 text-muted-foreground"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                (localStatus === "syncing" || connection.syncStatus === "syncing") &&
                  "animate-spin"
              )}
            />
          </Button>

          {/* Overflow menu */}
          <div ref={menuRef} className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`More options for ${connection.email}`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="h-8 w-8 text-muted-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border bg-popover shadow-lg"
                >
                  {/* Set as default */}
                  <button
                    role="menuitem"
                    onClick={handleSetDefault}
                    disabled={connection.isDefault || isBusy}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      "hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                  >
                    {connection.isDefault ? (
                      <Star className="h-4 w-4 fill-primary text-primary" />
                    ) : (
                      <StarOff className="h-4 w-4" />
                    )}
                    {connection.isDefault ? "Already default" : "Set as default"}
                  </button>

                  <div className="my-1 border-t" />

                  {/* Remove */}
                  {isOnly ? (
                    <div className="px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        Add another email before removing this one.
                      </p>
                    </div>
                  ) : (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowDeleteConfirm(true);
                      }}
                      disabled={isBusy}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Server details */}
      <div className="border-t px-4 py-2.5 flex items-center gap-4">
        <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>IMAP: {connection.imapHost}</span>
          <span>SMTP: {connection.smtpHost}</span>
        </div>
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-confirm-heading"
              className="border-t bg-destructive/5 px-4 py-3"
            >
              <p
                id="delete-confirm-heading"
                className="text-sm font-medium text-destructive"
              >
                Remove {connection.email}?
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This will remove the email connection from Kurir. Your messages
                and sender decisions will be deleted. This cannot be undone.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={isBusy}
                  aria-label={`Confirm removal of ${connection.email}`}
                >
                  {localStatus === "deleting" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Remove account"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isBusy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
