"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Share2,
} from "lucide-react";

export interface ViewerAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

function isImage(ct: string): boolean {
  return ct.startsWith("image/");
}

function isPdf(ct: string): boolean {
  return ct.toLowerCase() === "application/pdf";
}

/** Text we can safely render inline (everything but HTML, which could run script). */
function isViewableText(ct: string): boolean {
  return ct.startsWith("text/") && ct.toLowerCase() !== "text/html";
}

/**
 * Whether this attachment can be previewed in the in-app viewer. PDFs, images
 * and plain-text-ish files render inline; everything else is download/share only.
 */
export function canPreview(contentType: string): boolean {
  return isImage(contentType) || isPdf(contentType) || isViewableText(contentType);
}

/**
 * iOS Safari (including standalone PWAs) refuses to render PDFs inside an
 * <iframe>/<object>, so we fall back to an "Open" affordance there.
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports as MacIntel but is touch-capable.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function canShareFiles(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

/**
 * Full-screen-ish lightbox for previewing a single attachment. Renders images
 * and (where supported) PDFs inline, and always exposes Download / Open / Share
 * actions so the user can hand the file off to the OS.
 */
export function AttachmentViewer({
  attachment,
  open,
  onOpenChange,
}: {
  attachment: ViewerAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sharing, setSharing] = useState(false);

  // Reset transient state whenever a different attachment is shown.
  useEffect(() => {
    setSharing(false);
  }, [attachment?.id]);

  if (!attachment) return null;

  const url = `/api/attachments/${attachment.id}`;
  const inlineUrl = `${url}?inline=1`;
  const ct = attachment.contentType || "";

  async function handleShare() {
    if (!attachment || sharing) return;
    setSharing(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load attachment (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], attachment.filename, {
        type: blob.type || attachment.contentType || "application/octet-stream",
      });
      if (canShareFiles() && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: attachment.filename });
      } else {
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (err) {
      // AbortError = user dismissed the share sheet; not a real failure.
      if ((err as Error)?.name !== "AbortError") {
        console.error("Attachment share failed", err);
      }
    } finally {
      setSharing(false);
    }
  }

  const showShare = canShareFiles();

  let preview: React.ReactNode;
  if (isImage(ct)) {
    preview = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={attachment.filename}
        className="mx-auto max-h-full max-w-full object-contain"
      />
    );
  } else if (isPdf(ct) && !isIOS()) {
    preview = (
      <iframe
        src={inlineUrl}
        title={attachment.filename}
        className="h-full w-full border-0 bg-white"
      />
    );
  } else if (isViewableText(ct)) {
    preview = (
      <iframe
        src={inlineUrl}
        title={attachment.filename}
        className="h-full w-full border-0 bg-white"
      />
    );
  } else {
    // PDF on iOS (or anything else previewable we can't embed here).
    preview = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <FileText className="h-12 w-12 opacity-50" />
        <p className="text-sm">
          Inline preview isn&apos;t supported here. Use the buttons above to open
          or share the file.
        </p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[88vh] w-[96vw] max-w-4xl flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {attachment.filename}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={inlineUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open</span>
            </a>
            <a
              href={url}
              download={attachment.filename}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
            {showShare && (
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                title="Share"
              >
                {sharing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Share2 className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Share</span>
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30">{preview}</div>
      </DialogContent>
    </Dialog>
  );
}
