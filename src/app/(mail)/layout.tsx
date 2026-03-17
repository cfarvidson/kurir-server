import { Sidebar } from "@/components/layout/sidebar";
import { MobileSidebar } from "@/components/layout/mobile-sidebar";
import { AutoSync } from "@/components/mail/auto-sync";
import { PullToRefresh } from "@/components/mail/pull-to-refresh";
import { Providers } from "@/components/providers";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";

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
      where: visiblePendingSenderWhere(userId, excludedEmails.length > 0 ? excludedEmails : null),
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

  const [screenerCount, imboxUnreadCount] = await Promise.all([
    getScreenerCount(session.user.id, userEmails),
    getImboxUnreadCount(session.user.id),
  ]);

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
        <main className="flex-1 overflow-auto overscroll-y-contain">
          <PullToRefresh>{children}</PullToRefresh>
        </main>
        <AutoSync />
      </div>
    </Providers>
  );
}
