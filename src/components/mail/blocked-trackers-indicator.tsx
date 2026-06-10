import { ShieldCheck } from "lucide-react";

/**
 * Compact indicator shown above an email body in "load images, block trackers"
 * mode. The content images already loaded, so there is no "Load images" call to
 * action — this just reports how many trackers were stripped.
 */
export function BlockedTrackersIndicator({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
      <ShieldCheck className="h-3.5 w-3.5" />
      {count === 1 ? "1 tracker blocked" : `${count} trackers blocked`}
    </div>
  );
}
