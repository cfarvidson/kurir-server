import { Sidebar } from "@/components/layout/sidebar";
import { MobileSidebar } from "@/components/layout/mobile-sidebar";
import { AutoSync } from "@/components/mail/auto-sync";
import { SyncErrorBanner } from "@/components/mail/sync-error-banner";
import { PullToRefresh } from "@/components/mail/pull-to-refresh";
import { KeyboardShortcuts } from "@/components/mail/keyboard-shortcuts";
import { CommandPaletteShell } from "@/components/mail/command-palette-shell";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { getBadgePreferences } from "@/actions/badge-preferences";

async function getUserEmails(userId: string): Promise<string[]> {
  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { email: true, sendAsEmail: true, aliases: true },
  });
  return [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];
}

export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const userEmails = await getUserEmails(session.user.id);

  const [
    screenerCount,
    imboxUnreadCount,
    scheduledCount,
    followUpCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    badgePreferences,
  ] = await Promise.all([
    db.sender.count({
      where: visiblePendingSenderWhere(
        session.user.id,
        userEmails.length > 0 ? userEmails : null,
      ),
    }),
    db.message.count({
      where: { userId: session.user.id, isInImbox: true, isRead: false },
    }),
    db.scheduledMessage.count({
      where: { userId: session.user.id, status: "PENDING" },
    }),
    db.message.count({
      where: { userId: session.user.id, isFollowUp: true },
    }),
    db.message.count({
      where: { userId: session.user.id, isInFeed: true, isRead: false },
    }),
    db.message.count({
      where: { userId: session.user.id, isInPaperTrail: true, isRead: false },
    }),
    getBadgePreferences(session.user.id),
  ]);

  return (
    <Providers>
      <div className="flex h-screen h-dvh">
        <Sidebar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
          scheduledCount={scheduledCount}
          followUpCount={followUpCount}
          feedUnreadCount={feedUnreadCount}
          paperTrailUnreadCount={paperTrailUnreadCount}
          badgePreferences={badgePreferences}
        />
        <MobileSidebar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
          scheduledCount={scheduledCount}
          followUpCount={followUpCount}
          feedUnreadCount={feedUnreadCount}
          paperTrailUnreadCount={paperTrailUnreadCount}
          badgePreferences={badgePreferences}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <SyncErrorBanner />
          <main className="flex-1 overflow-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
            <PullToRefresh>{children}</PullToRefresh>
          </main>
        </div>
        <AutoSync />
        <KeyboardShortcuts />
        <CommandPaletteShell />
        <Toaster
          position="bottom-right"
          expand={false}
          visibleToasts={4}
          toastOptions={{
            className:
              "border border-border bg-card text-card-foreground shadow-lg",
            style: {
              "--toast-bg": "hsl(var(--card))",
              "--toast-border": "hsl(var(--border))",
              "--toast-text": "hsl(var(--card-foreground))",
            } as React.CSSProperties,
          }}
        />
      </div>
    </Providers>
  );
}
