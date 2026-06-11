import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { AutoSync } from "@/components/mail/auto-sync";
import { SyncErrorBanner } from "@/components/mail/sync-error-banner";
import { PullToRefresh } from "@/components/mail/pull-to-refresh";
import { KeyboardShortcuts } from "@/components/mail/keyboard-shortcuts";
import { CommandPaletteShell } from "@/components/mail/command-palette-shell";
import { BackGestureBlocker } from "@/components/layout/back-gesture-blocker";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";
import {
  TOAST_SHELL_CLASS,
  TOAST_SHELL_STYLE,
} from "@/components/ui/toast-config";
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
    replyLaterCount,
    feedUnreadCount,
    paperTrailUnreadCount,
    badgePreferences,
    userTheme,
  ] = await Promise.all([
    db.sender.count({
      where: visiblePendingSenderWhere(
        session.user.id,
        userEmails.length > 0 ? userEmails : null,
      ),
    }),
    db.message.count({
      where: {
        userId: session.user.id,
        isInImbox: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    db.scheduledMessage.count({
      where: { userId: session.user.id, status: "PENDING" },
    }),
    db.message.count({
      where: { userId: session.user.id, isFollowUp: true, isArchived: false },
    }),
    db.message.count({
      where: { userId: session.user.id, isReplyLater: true, isArchived: false },
    }),
    db.message.count({
      where: {
        userId: session.user.id,
        isInFeed: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    db.message.count({
      where: {
        userId: session.user.id,
        isInPaperTrail: true,
        isRead: false,
        isSnoozed: false,
        isReplyLater: false,
      },
    }),
    getBadgePreferences(session.user.id),
    db.user
      .findUnique({
        where: { id: session.user.id },
        select: { theme: true },
      })
      .then((u) => u?.theme ?? "system"),
  ]);

  return (
    <Providers defaultTheme={userTheme} userId={session.user.id}>
      <div className="flex h-screen h-dvh">
        <Sidebar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
          scheduledCount={scheduledCount}
          followUpCount={followUpCount}
          replyLaterCount={replyLaterCount}
          feedUnreadCount={feedUnreadCount}
          paperTrailUnreadCount={paperTrailUnreadCount}
          badgePreferences={badgePreferences}
          isAdmin={session.user.role === "ADMIN"}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <SyncErrorBanner />
          <main className="flex-1 overflow-auto overscroll-contain touch-pan-y pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <PullToRefresh>{children}</PullToRefresh>
          </main>
        </div>
        <MobileTabBar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
          feedUnreadCount={feedUnreadCount}
          paperTrailUnreadCount={paperTrailUnreadCount}
          scheduledCount={scheduledCount}
          followUpCount={followUpCount}
          replyLaterCount={replyLaterCount}
          badgePreferences={badgePreferences}
          isAdmin={session.user.role === "ADMIN"}
        />
        <AutoSync />
        <BackGestureBlocker />
        <KeyboardShortcuts />
        <CommandPaletteShell />
        <Toaster
          className="mail-toaster"
          position="bottom-right"
          expand={false}
          visibleToasts={4}
          // Lift toasts above the mobile tab bar / thread action bar
          // (both are fixed bottom-0 with height ≈3.5rem + safe-area-inset).
          mobileOffset={{
            bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)",
            left: "1rem",
            right: "1rem",
          }}
          toastOptions={{
            className: TOAST_SHELL_CLASS,
            style: TOAST_SHELL_STYLE,
          }}
        />
      </div>
    </Providers>
  );
}
