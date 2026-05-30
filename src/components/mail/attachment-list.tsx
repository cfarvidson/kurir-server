"use client";

import { useState } from "react";
import { Eye, Loader2, Paperclip } from "lucide-react";
import {
  AttachmentViewer,
  canPreview,
  type ViewerAttachment,
} from "@/components/mail/attachment-viewer";
import { shareOrOpenAttachment } from "@/lib/mail/attachment-share";

interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
  contentType: string;
}

function formatSize(size: number): string {
  return size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`;
}

/**
 * Renders email attachments.
 *
 * Previewable files (PDFs, images, plain text) open in an in-app viewer where
 * the user can read them and then download/open/share. Everything else keeps
 * the plain download behaviour, with one exception: on touch devices (notably
 * iOS PWAs, where the `download` attribute is ignored and tapping a link is a
 * dead end) the tap is intercepted to open the native share sheet via the Web
 * Share API, letting the user Save to Files, AirDrop, print, etc.
 */
export function AttachmentList({
  attachments,
}: {
  attachments: AttachmentItem[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewerAttachment | null>(null);

  async function handleShareClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    att: AttachmentItem,
  ) {
    // Only take over the click on coarse-pointer devices that can share files.
    // On desktop we leave the normal download behaviour untouched.
    const canUseShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)")?.matches === true;

    if (!canUseShare) return; // let <a download> behave normally
    if (busyId) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    setBusyId(att.id);
    try {
      await shareOrOpenAttachment(att.id, att.filename, att.contentType);
    } catch (err) {
      // AbortError = user dismissed the share sheet; that's not a failure.
      if ((err as Error)?.name !== "AbortError") {
        console.error("Attachment share failed", err);
        // Last-ditch fallback: navigate straight to the attachment.
        window.location.href = `/api/attachments/${att.id}`;
      }
    } finally {
      setBusyId(null);
    }
  }

  const chipClass =
    "inline-flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs transition-colors hover:bg-muted";

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {attachments.map((att) => {
          const previewable = canPreview(att.contentType);
          const label = (
            <>
              {previewable ? (
                <Eye className="h-3 w-3 text-primary/60" />
              ) : busyId === att.id ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary/60" />
              ) : (
                <Paperclip className="h-3 w-3 text-primary/60" />
              )}
              <span className="max-w-[200px] truncate font-medium">
                {att.filename}
              </span>
              <span className="text-muted-foreground/60">
                {formatSize(att.size)}
              </span>
            </>
          );

          return previewable ? (
            <button
              key={att.id}
              type="button"
              onClick={() => setViewing(att)}
              className={chipClass}
              title="Preview"
            >
              {label}
            </button>
          ) : (
            <a
              key={att.id}
              href={`/api/attachments/${att.id}`}
              download={att.filename}
              onClick={(e) => handleShareClick(e, att)}
              className={chipClass}
            >
              {label}
            </a>
          );
        })}
      </div>

      <AttachmentViewer
        attachment={viewing}
        open={viewing !== null}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
      />
    </>
  );
}
