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
import { unstable_cache } from "next/cache";
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

const getScreenerCount = unstable_cache(
  async (userId: string, excludedEmails: string[]) =>
    db.sender.count({
      where: visiblePendingSenderWhere(
        userId,
        excludedEmails.length > 0 ? excludedEmails : null,
      ),
    }),
  ["screener-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getImboxUnreadCount = unstable_cache(
  async (userId: string) =>
    db.message.count({ where: { userId, isInImbox: true, isRead: false } }),
  ["imbox-unread-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getScheduledCount = unstable_cache(
  async (userId: string) =>
    db.scheduledMessage.count({ where: { userId, status: "PENDING" } }),
  ["scheduled-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getFollowUpCount = unstable_cache(
  async (userId: string) =>
    db.message.count({ where: { userId, isFollowUp: true } }),
  ["follow-up-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getFeedUnreadCount = unstable_cache(
  async (userId: string) =>
    db.message.count({ where: { userId, isInFeed: true, isRead: false } }),
  ["feed-unread-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getPaperTrailUnreadCount = unstable_cache(
  async (userId: string) =>
    db.message.count({
      where: { userId, isInPaperTrail: true, isRead: false },
    }),
  ["paper-trail-unread-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getCachedBadgePreferences = unstable_cache(
  getBadgePreferences,
  ["badge-preferences"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

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
    getScreenerCount(session.user.id, userEmails),
    getImboxUnreadCount(session.user.id),
    getScheduledCount(session.user.id),
    getFollowUpCount(session.user.id),
    getFeedUnreadCount(session.user.id),
    getPaperTrailUnreadCount(session.user.id),
    getCachedBadgePreferences(session.user.id),
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
