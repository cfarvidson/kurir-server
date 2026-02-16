import { Sidebar } from "@/components/layout/sidebar";
import { MobileSidebar } from "@/components/layout/mobile-sidebar";
import { AutoSync } from "@/components/mail/auto-sync";
import { Providers } from "@/components/providers";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";

const getScreenerCount = unstable_cache(
  async (userId: string) =>
    db.sender.count({ where: { userId, status: "PENDING" } }),
  ["screener-count"],
  { tags: ["sidebar-counts"], revalidate: 30 }
);

const getImboxUnreadCount = unstable_cache(
  async (userId: string) =>
    db.message.count({ where: { userId, isInImbox: true, isRead: false } }),
  ["imbox-unread-count"],
  { tags: ["sidebar-counts"], revalidate: 30 }
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

  const [screenerCount, imboxUnreadCount] = await Promise.all([
    getScreenerCount(session.user.id),
    getImboxUnreadCount(session.user.id),
  ]);

  return (
    <Providers>
      <div className="flex h-screen">
        <Sidebar screenerCount={screenerCount} imboxUnreadCount={imboxUnreadCount} />
        <MobileSidebar screenerCount={screenerCount} imboxUnreadCount={imboxUnreadCount} />
        <main className="flex-1 overflow-auto">{children}</main>
        <AutoSync />
      </div>
    </Providers>
  );
}
