import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminPanel } from "@/components/settings/admin-panel";
import { InvitesPanel } from "@/components/admin/invites-panel";
import { SystemPanel } from "@/components/admin/system-panel";
import { UserConnectionsPanel } from "@/components/admin/user-connections-panel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function AdminSettingsPage() {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    redirect("/settings");
  }

  const [users, settings, invites] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        displayName: true,
        role: true,
        createdAt: true,
        _count: { select: { emailConnections: true } },
        emailConnections: {
          select: {
            id: true,
            email: true,
            displayName: true,
            imapHost: true,
            smtpHost: true,
            isDefault: true,
            createdAt: true,
            syncState: {
              select: {
                isSyncing: true,
                syncError: true,
                lastFullSync: true,
                lastSyncLog: true,
              },
            },
          },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    }),
    db.systemSettings.upsert({
      where: { id: "singleton" },
      create: {},
      update: {},
    }),
    db.invite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        displayName: true,
        emailHint: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b pl-14 pr-4 md:px-6">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold md:text-2xl">Admin</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-6 md:space-y-8">
          <AdminPanel
            currentUserId={session.user.id}
            signupsEnabled={settings.signupsEnabled}
            selfServiceAccountManagement={settings.selfServiceAccountManagement}
            users={users.map((u) => ({
              id: u.id,
              displayName: u.displayName,
              role: u.role,
              createdAt: u.createdAt.toISOString(),
              emailConnectionCount: u._count.emailConnections,
            }))}
          />

          <InvitesPanel
            invites={invites.map((i) => ({
              ...i,
              expiresAt: i.expiresAt.toISOString(),
              createdAt: i.createdAt.toISOString(),
            }))}
          />

          <UserConnectionsPanel
            users={users.map((u) => ({
              id: u.id,
              displayName: u.displayName,
              connections: u.emailConnections.map((c) => ({
                ...c,
                createdAt: c.createdAt.toISOString(),
                syncState: c.syncState
                  ? {
                      ...c.syncState,
                      lastFullSync:
                        c.syncState.lastFullSync?.toISOString() ?? null,
                    }
                  : null,
              })),
            }))}
          />

          <SystemPanel />
        </div>
      </div>
    </div>
  );
}
