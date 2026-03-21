"use client";

import { Paperclip, Loader2, X, AlertCircle } from "lucide-react";
import type { UploadedAttachment } from "@/hooks/use-attachments";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentChipsProps {
  attachments: UploadedAttachment[];
  onRemove: (id: string) => void;
  /** Only show non-image attachments (images are shown inline in markdown) */
  excludeImages?: boolean;
}

export function AttachmentChips({
  attachments,
  onRemove,
  excludeImages = false,
}: AttachmentChipsProps) {
  const visible = excludeImages
    ? attachments.filter((a) => !a.contentType.startsWith("image/"))
    : attachments;

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((attachment) => (
        <div
          key={attachment.id}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
            attachment.status === "error"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/30 text-foreground"
          }`}
        >
          {attachment.status === "uploading" ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : attachment.status === "error" ? (
            <AlertCircle className="h-3 w-3" />
          ) : (
            <Paperclip className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="max-w-[150px] truncate">{attachment.filename}</span>
          <span className="text-muted-foreground">
            {formatSize(attachment.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
