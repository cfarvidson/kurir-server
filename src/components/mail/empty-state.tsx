import { cn } from "@/lib/utils";

/**
 * Editorial empty state. A Playfair headline carries the moment — this is one
 * of the few intentional places (alongside the open-message subject) where the
 * serif earns its keep. The icon is a quiet muted glyph, not a tinted circle:
 * depth comes from type and spacing, not decoration.
 */
export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  className,
}: {
  icon?: React.ReactNode;
  /** Optional small-caps kicker above the headline, matching PageMasthead. */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center px-6 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-5 text-muted-foreground/35 [&_svg]:h-7 [&_svg]:w-7"
        >
          {icon}
        </div>
      )}
      {eyebrow && (
        <p className="eyebrow mb-2 text-muted-foreground/70">{eyebrow}</p>
      )}
      <h2 className="font-serif text-title text-foreground">{title}</h2>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
