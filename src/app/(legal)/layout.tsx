/**
 * Public legal pages (privacy / terms / support). Centered prose on flat
 * paper, same type system as the auth pages: Playfair wordmark, Inter body.
 * No auth, no client JS — plain server-rendered documents reachable without
 * a session (allowlisted in src/proxy.ts).
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-2xl px-6 py-12 lg:py-16">
        <header className="mb-10">
          <a href="/login" className="inline-block">
            <span className="font-serif text-headline font-semibold tracking-tight text-foreground">
              Kurir
            </span>
          </a>
        </header>
        <main className="space-y-6 text-sm leading-relaxed text-foreground">
          {children}
        </main>
        <footer className="mt-12 border-t border-border pt-6">
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground hover:underline">
              Privacy
            </a>
            <a href="/terms" className="hover:text-foreground hover:underline">
              Terms
            </a>
            <a href="/support" className="hover:text-foreground hover:underline">
              Support
            </a>
            <a href="/login" className="hover:text-foreground hover:underline">
              Sign in
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
