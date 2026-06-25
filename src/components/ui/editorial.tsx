import { cn } from "@/lib/utils";

/**
 * Editorial primitives for the redesign. These replace shadcn-style stat-card
 * grids and bordered "section cards" with type-led, hairline-ruled layouts —
 * the Stripe/Vercel definition-list idiom rather than a dashboard of boxes.
 */

/**
 * Stat — a single editorial figure. A large serif numeral over a small-caps
 * eyebrow label. No card, no shadow, no border; depth is the type contrast.
 * Lay several out in a flex/grid row separated by whitespace, not boxes.
 */
export function Stat({
  value,
  label,
  className,
}: {
  value: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="font-serif text-headline tabular-nums text-foreground">
        {value}
      </div>
      <div className="eyebrow mt-1 text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * SectionHeading — eyebrow + title pairing for a settings/section block.
 * The in-page echo of PageMasthead, without the page-level rule.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("", className)}>
      {eyebrow && <p className="eyebrow text-muted-foreground">{eyebrow}</p>}
      <h2 className="mt-0.5 font-serif text-title font-semibold text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

/**
 * DefinitionList — hairline-divided label/value rows. The editorial alternative
 * to a bordered card full of fields.
 */
export function DefinitionList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-border", className)}>{children}</dl>
  );
}

/**
 * DefinitionRow — one row inside a DefinitionList. `label` is the quiet term,
 * `children` is the value/control (right-aligned, tabular numerals).
 */
export function DefinitionRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3.5",
        className,
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums text-foreground">
        {children}
      </dd>
    </div>
  );
}
