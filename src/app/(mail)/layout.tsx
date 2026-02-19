import { Sidebar } from "@/components/layout/sidebar";
import { MobileSidebar } from "@/components/layout/mobile-sidebar";
import { AutoSync } from "@/components/mail/auto-sync";
import { Providers } from "@/components/providers";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { connectionManager } from "@/lib/mail/connection-manager";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";

const getScreenerCount = unstable_cache(
  async (userId: string, excludedEmail?: string | null) =>
    db.sender.count({ where: visiblePendingSenderWhere(userId, excludedEmail) }),
  ["screener-count"],
  { tags: ["sidebar-counts"], revalidate: 30 },
);

const getImboxUnreadCount = unstable_cache(
  async (userId: string) =>
    db.message.count({ where: { userId, isInImbox: true, isRead: false } }),
  ["imbox-unread-count"],
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

  const userEmail = session.user.email?.trim().toLowerCase();

  const [screenerCount, imboxUnreadCount] = await Promise.all([
    getScreenerCount(session.user.id, userEmail),
    getImboxUnreadCount(session.user.id),
  ]);

  // Start IDLE connection for realtime IMAP sync (no-op if already connected)
  connectionManager.startUser(session.user.id).catch(console.error);

  return (
    <Providers>
      <div className="flex h-screen">
        <Sidebar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
        />
        <MobileSidebar
          screenerCount={screenerCount}
          imboxUnreadCount={imboxUnreadCount}
        />
        <main className="flex-1 overflow-auto">{children}</main>
        <AutoSync />
      </div>
    </Providers>
  );
}
