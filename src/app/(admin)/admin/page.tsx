import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { HealthSection } from "@/components/admin/health-section";
import { SyncSection } from "@/components/admin/sync-section";
import { UsersSection } from "@/components/admin/users-section";
import { LogsSection } from "@/components/admin/logs-section";
import pkg from "@/../package.json";

export default async function AdminDashboardPage() {
  const session = await auth();

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
                syncStartedAt: true,
                syncError: true,
                lastFullSync: true,
                lastSyncLog: true,
              },
            },
          },
          orderBy: [
            { isDefault: "desc" as const },
            { createdAt: "asc" as const },
          ],
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

  // Build sync connections list (all connections across all users)
  const syncConnections = users.flatMap((u) =>
    u.emailConnections.map((c) => ({
      id: c.id,
      email: c.email,
      imapHost: c.imapHost,
      isDefault: c.isDefault,
      userName: u.displayName,
      syncState: c.syncState
        ? {
            isSyncing: c.syncState.isSyncing,
            syncStartedAt: c.syncState.syncStartedAt?.toISOString() ?? null,
            syncError: c.syncState.syncError,
            lastFullSync: c.syncState.lastFullSync?.toISOString() ?? null,
            lastSyncLog: c.syncState.lastSyncLog,
          }
        : null,
    })),
  );

  // Version info (static per deployment)
  const config = getConfig();
  const versionInfo = {
    version: pkg.version,
    node: process.version,
    env: process.env.NODE_ENV ?? "development",
    domain: config.domain,
  };

  return (
    <AdminTabs
      healthContent={<HealthSection versionInfo={versionInfo} />}
      syncContent={<SyncSection connections={syncConnections} />}
      usersContent={
        <UsersSection
          currentUserId={session!.user.id}
          signupsEnabled={settings.signupsEnabled}
          selfServiceAccountManagement={settings.selfServiceAccountManagement}
          users={users.map((u) => ({
            id: u.id,
            displayName: u.displayName,
            role: u.role as "ADMIN" | "USER",
            createdAt: u.createdAt.toISOString(),
            emailConnectionCount: u._count.emailConnections,
          }))}
          invites={invites.map((i) => ({
            ...i,
            expiresAt: i.expiresAt.toISOString(),
            createdAt: i.createdAt.toISOString(),
          }))}
          usersWithConnections={users.map((u) => ({
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
      }
      logsContent={<LogsSection />}
    />
  );
}
