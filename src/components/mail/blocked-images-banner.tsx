"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { setSenderImagePolicy } from "@/actions/image-policy";

interface BlockedImagesBannerProps {
  /** Number of remote images that were blocked in this message. */
  count: number;
  /** Sender id, when known — enables the "always trust" action. */
  senderId?: string;
  /** Human label for the sender (display name or email). */
  senderLabel?: string;
  /** Reveal the images for this message only (client-side). */
  onLoadImages: () => void;
}

/**
 * Shown above an email body when remote images (potential tracking pixels)
 * were blocked. Offers a one-time "Load images" reveal and, when the sender
 * is known, an "Always show from this sender" allowlist action.
 */
export function BlockedImagesBanner({
  count,
  senderId,
  senderLabel,
  onLoadImages,
}: BlockedImagesBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [trusted, setTrusted] = useState(false);

  function handleAlwaysShow() {
    if (!senderId) return;
    setTrusted(true);
    onLoadImages();
    startTransition(async () => {
      try {
        await setSenderImagePolicy(senderId, true);
        router.refresh();
      } catch {
        // Revert the optimistic state if the server rejected the change.
        setTrusted(false);
      }
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <ShieldCheck className="h-3.5 w-3.5" />
        {count === 1
          ? "1 tracker blocked"
          : `${count} trackers blocked`}
      </span>
      <span className="text-amber-700/80 dark:text-amber-300/70">
        Remote images aren&apos;t loaded to protect your privacy.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onLoadImages}
          className="rounded-md bg-amber-100 px-2 py-1 font-medium transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
        >
          Load images
        </button>
        {senderId && !trusted && (
          <button
            type="button"
            onClick={handleAlwaysShow}
            disabled={isPending}
            className="rounded-md px-2 py-1 font-medium underline-offset-2 transition-colors hover:underline disabled:opacity-50"
          >
            Always show from {senderLabel ?? "this sender"}
          </button>
        )}
      </div>
    </div>
  );
}
