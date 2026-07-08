import { PageMasthead } from "@/components/layout/page-masthead";
import { Skeleton } from "@/components/ui/skeleton";

// Deterministic width variation so rows read as content, not a grid.
const SENDER_WIDTHS = ["w-32", "w-40", "w-28", "w-36", "w-44", "w-32"];
const SUBJECT_WIDTHS = ["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5", "w-3/4"];
const SNIPPET_WIDTHS = ["w-1/2", "w-3/5", "w-2/5", "w-1/2", "w-1/3", "w-2/5"];

/**
 * Instant loading fallback for the mail list views (`loading.tsx`). Renders
 * the real masthead immediately so switching views feels like arriving on the
 * page, with shimmering rows standing in for the list while it streams.
 */
export function MailListSkeleton({
  eyebrow,
  title,
  rows = 8,
}: {
  eyebrow: string;
  title: string;
  rows?: number;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageMasthead eyebrow={eyebrow} title={title} />
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="border-b border-border px-4 py-3 md:px-6 md:py-4"
          >
            <div className="flex items-center">
              <Skeleton className={`h-4 ${SENDER_WIDTHS[i % 6]} max-w-[45%]`} />
              <Skeleton className="ml-auto h-3 w-12" />
            </div>
            <Skeleton className={`mt-2 h-4 ${SUBJECT_WIDTHS[i % 6]}`} />
            <Skeleton className={`mt-2 h-3 ${SNIPPET_WIDTHS[i % 6]}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Instant loading fallback for thread detail views (`[id]/loading.tsx`).
 * Mirrors the ThreadDetailView chrome: back-bar with the category label,
 * then a serif-sized subject bar and quiet body lines.
 */
export function ThreadSkeleton({ categoryLabel }: { categoryLabel: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xs md:px-6">
        <span className="eyebrow text-muted-foreground">{categoryLabel}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-8">
          <Skeleton className="h-8 w-4/5 md:h-10" />
          <div className="mt-6 space-y-3 md:mt-8">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-8 space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
