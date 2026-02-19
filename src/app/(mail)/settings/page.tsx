import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ImportButton } from "@/components/mail/import-button";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";

async function getUserStats(userId: string) {
  const [senderCount, messageCount, pendingCount] = await Promise.all([
    db.sender.count({ where: { userId } }),
    db.message.count({ where: { userId } }),
    db.sender.count({ where: visiblePendingSenderWhere(userId) }),
  ]);

  return { senderCount, messageCount, pendingCount };
}

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      displayName: true,
      imapHost: true,
      smtpHost: true,
      createdAt: true,
    },
  });

  const stats = await getUserStats(session.user.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-6 md:space-y-8">
          {/* Account Info */}
          <section>
            <h2 className="text-lg font-medium">Account</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-sm text-muted-foreground">Email</dt>
                  <dd className="text-sm font-medium">{user?.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-muted-foreground">IMAP Server</dt>
                  <dd className="text-sm font-medium">{user?.imapHost}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-muted-foreground">SMTP Server</dt>
                  <dd className="text-sm font-medium">{user?.smtpHost}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-muted-foreground">Connected</dt>
                  <dd className="text-sm font-medium">
                    {user?.createdAt.toLocaleDateString()}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Stats */}
          <section>
            <h2 className="text-lg font-medium">Statistics</h2>
            <div className="mt-4 grid grid-cols-3 gap-2 md:gap-4">
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.messageCount}</div>
                <div className="text-sm text-muted-foreground">Messages</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.senderCount}</div>
                <div className="text-sm text-muted-foreground">Senders</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.pendingCount}</div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </div>
            </div>
          </section>

          {/* Import */}
          <section>
            <h2 className="text-lg font-medium">Import</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Import all messages from your IMAP account. Progress will appear
                at the bottom of the screen.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Resync erases all cached mail and sender decisions, then
                re-imports from IMAP. All senders return to the Screener.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ImportButton />
                <ImportButton mode="resync" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
