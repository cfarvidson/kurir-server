import { cn } from "@/lib/utils";

/**
 * PageMasthead — the canonical page-chrome primitive for the editorial redesign.
 *
 * Replaces the old generic `h-16 border-b` header bar everywhere. The shape is
 * deliberately editorial: a small-caps eyebrow kicker frames a Playfair title,
 * with optional meta beneath and an actions slot (search, filters, buttons) on
 * the right. Depth is a single hairline rule — no shadow. The vertical rhythm is
 * intentionally roomier and uneven (more top than bottom) so the title breathes.
 *
 * Keep this the single source of page chrome so every surface shares one rhythm
 * rather than each page inventing its own header.
 */
export function PageMasthead({
  eyebrow,
  title,
  serif = true,
  meta,
  actions,
  children,
  className,
}: {
  /** Small-caps kicker above the title (e.g. "Mailbox", "Triage", "Account"). */
  eyebrow?: string;
  title: React.ReactNode;
  /** Title uses Playfair by default; set false for a sans title. */
  serif?: boolean;
  /** Quiet supporting line under the title (counts, context). */
  meta?: React.ReactNode;
  /** Right-aligned controls — search, filters, primary action. */
  actions?: React.ReactNode;
  /** Optional full-width row rendered below the title block, inside the rule. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "shrink-0 border-b border-border bg-background",
        className,
      )}
    >
      <div className="flex items-end justify-between gap-4 px-4 pt-5 pb-3 md:px-6 md:pt-6 md:pb-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="eyebrow text-muted-foreground">{eyebrow}</p>
          )}
          <h1
            className={cn(
              "truncate text-title text-foreground",
              eyebrow && "mt-0.5",
              serif && "font-serif font-semibold",
            )}
          >
            {title}
          </h1>
          {meta && (
            <div className="mt-1 text-sm text-muted-foreground tabular-nums">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}
