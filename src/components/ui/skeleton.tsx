import { cn } from "@/lib/utils";

/**
 * Shimmer placeholder bar (DESIGN.md: skeletons use `animate-shimmer`,
 * not pulse). Muted base with a quiet highlight sweeping across.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-sm bg-muted", className)}
    >
      <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-foreground/5 to-transparent" />
    </div>
  );
}
