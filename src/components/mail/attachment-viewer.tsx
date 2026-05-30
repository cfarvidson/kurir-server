"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Share2,
} from "lucide-react";
import {
  canPreview,
  isPdf,
  isSafeInlineImage,
  isViewableText,
} from "@/lib/mail/attachment-types";
import {
  canShareFiles,
  shareOrOpenAttachment,
} from "@/lib/mail/attachment-share";

export interface ViewerAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

// Re-exported so call sites (AttachmentList, FilesList) keep importing the
// preview predicate from the viewer; the policy itself lives in attachment-types.
export { canPreview };

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
  const shareAbortRef = useRef<AbortController | null>(null);

  // When a different attachment is shown, reset transient state and abort any
  // in-flight share fetch so a stale request can't share the previous file.
  useEffect(() => {
    setSharing(false);
    return () => {
      shareAbortRef.current?.abort();
    };
  }, [attachment?.id]);

  if (!attachment) return null;

  const url = `/api/attachments/${attachment.id}`;
  const inlineUrl = `${url}?inline=1`;
  const ct = attachment.contentType || "";

  async function handleShare() {
    if (!attachment || sharing) return;
    shareAbortRef.current?.abort();
    const ac = new AbortController();
    shareAbortRef.current = ac;
    setSharing(true);
    try {
      await shareOrOpenAttachment(
        attachment.id,
        attachment.filename,
        attachment.contentType,
        ac.signal,
      );
    } catch (err) {
      // AbortError = user dismissed the share sheet (or we cancelled a stale
      // request); not a real failure.
      if ((err as Error)?.name !== "AbortError") {
        console.error("Attachment share failed", err);
      }
    } finally {
      // Only clear the spinner if this is still the current share.
      if (shareAbortRef.current === ac) setSharing(false);
    }
  }

  const showShare = canShareFiles();

  let preview: React.ReactNode;
  if (isSafeInlineImage(ct)) {
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
      // sandbox (no allow-scripts) prevents the text document from executing
      // script even if it is mislabelled; pairs with the route's CSP + nosniff.
      <iframe
        src={inlineUrl}
        title={attachment.filename}
        sandbox=""
        className="h-full w-full border-0 bg-white"
      />
    );
  } else {
    // PDF on iOS (or anything else previewable we can't embed here).
    preview = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <FileText className="h-12 w-12 opacity-50" />
        <p className="text-sm">
          Inline preview isn&apos;t supported here. Use the buttons above to
          open or share the file.
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
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
          {preview}
        </div>
      </DialogContent>
    </Dialog>
  );
}
