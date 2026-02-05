import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

async function getUserStats(userId: string) {
  const [senderCount, messageCount, pendingCount] = await Promise.all([
    db.sender.count({ where: { userId } }),
    db.message.count({ where: { userId } }),
    db.sender.count({ where: { userId, status: "PENDING" } }),
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
      <div className="flex h-16 items-center justify-between border-b px-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-8">
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
            <div className="mt-4 grid grid-cols-3 gap-4">
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

          {/* Sync */}
          <section>
            <h2 className="text-lg font-medium">Sync</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Manually trigger an email sync to fetch new messages.
              </p>
              <form action="/api/mail/sync" method="POST" className="mt-4">
                <Button type="submit" variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Now
                </Button>
              </form>
            </div>
          </section>

          {/* Manage Senders */}
          <section>
            <h2 className="text-lg font-medium">Senders</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                View and manage all senders you&apos;ve approved or rejected.
              </p>
              <Button asChild variant="outline" className="mt-4">
                <Link href="/settings/senders">Manage Senders</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
