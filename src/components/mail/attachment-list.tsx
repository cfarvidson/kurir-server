"use client";

import { useState } from "react";
import { Loader2, Paperclip } from "lucide-react";

interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
}

function formatSize(size: number): string {
  return size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`;
}

/**
 * Renders email attachments. On touch devices (notably iOS PWAs, where the
 * `download` attribute is ignored and tapping a PDF link is a dead end) the
 * tap is intercepted to open the native share sheet via the Web Share API,
 * letting the user Save to Files, open in Books, AirDrop, print, etc.
 *
 * Everywhere else the plain `<a download>` behaviour is preserved.
 */
export function AttachmentList({
  attachments,
}: {
  attachments: AttachmentItem[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleClick(
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
      const res = await fetch(`/api/attachments/${att.id}`);
      if (!res.ok) {
        throw new Error(`Failed to load attachment (${res.status})`);
      }
      const blob = await res.blob();
      const file = new File([blob], att.filename, {
        type: blob.type || "application/octet-stream",
      });

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: att.filename });
      } else {
        // File sharing unsupported on this device — open in a new tab so the
        // browser can preview/save it.
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
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

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {attachments.map((att) => (
        <a
          key={att.id}
          href={`/api/attachments/${att.id}`}
          download={att.filename}
          onClick={(e) => handleClick(e, att)}
          className="inline-flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          {busyId === att.id ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary/60" />
          ) : (
            <Paperclip className="h-3 w-3 text-primary/60" />
          )}
          <span className="max-w-[200px] truncate font-medium">
            {att.filename}
          </span>
          <span className="text-muted-foreground/60">{formatSize(att.size)}</span>
        </a>
      ))}
    </div>
  );
}
