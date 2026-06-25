import { cn } from "@/lib/utils";

/**
 * Editorial auth layout. Flat paper (bg-background), no gradient hero, no
 * card shadows. Asymmetric two-column on wide screens — left rail carries the
 * Playfair wordmark + eyebrow tagline + a one-line editorial sentence; right
 * column holds the form. Stacks to a single column on mobile.
 *
 * The wordmark is one of Playfair's intentional homes (font-serif). Labels,
 * inputs, and buttons stay in Inter — composed by the form children.
 */
export function AuthShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 lg:grid-cols-[1fr_1px_minmax(0,28rem)]">
        {/* Left rail — type-led masthead. The wordmark block is vertically
            centered so it aligns with the form across the hairline; the tagline
            is pinned to the bottom corner as an editorial footer. */}
        <aside className="relative flex flex-col justify-center px-6 pt-12 pb-8 lg:px-12 lg:py-16">
          <div>
            <p className="eyebrow text-muted-foreground">Email for humans</p>
            <h1 className="mt-3 font-serif text-display font-semibold tracking-tight text-foreground">
              Kurir
            </h1>
            <p className="mt-4 max-w-sm text-lead text-muted-foreground">
              A calmer inbox. Senders earn their place — the noise stays in the
              Screener, the people you care about land up front.
            </p>
          </div>
          <p className="absolute bottom-8 left-6 hidden text-eyebrow text-muted-foreground lg:left-12 lg:block">
            Passwordless. Passkey-first.
          </p>
        </aside>

        {/* Hairline divider — only on the two-column layout */}
        <div className="hidden bg-border lg:block" aria-hidden="true" />

        {/* Right column — the form */}
        <main
          className={cn(
            "flex flex-col justify-center px-6 pb-16 pt-4 lg:px-12 lg:py-16",
            className,
          )}
        >
          <div className="w-full max-w-sm lg:mx-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
