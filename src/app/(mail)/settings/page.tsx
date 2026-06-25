import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ImportButton } from "@/components/mail/import-button";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { ConnectionsList } from "@/components/settings/connections-list";
import { PasskeysList } from "@/components/settings/passkeys-list";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ChevronRight, PlusCircle, Shield } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EmailConnection } from "@/components/settings/connection-card";
import type { PasskeyInfo } from "@/components/settings/passkey-card";
import { WipeButton, WipeMailButton } from "@/components/settings/wipe-button";
import { DisplayNameField } from "@/components/settings/display-name-field";
import { ScreenRecentButton } from "@/components/settings/screen-recent-button";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { BadgePreferencesSettings } from "@/components/settings/badge-preferences";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { ImagePrivacySettings } from "@/components/settings/image-privacy-settings";
import { getBadgePreferences } from "@/actions/badge-preferences";
import { resolveImagePolicy } from "@/lib/mail/image-policy";
import { PageMasthead } from "@/components/layout/page-masthead";
import {
  Stat,
  SectionHeading,
  DefinitionList,
  DefinitionRow,
} from "@/components/ui/editorial";

interface StorageRow {
  name: string;
  total: string;
  data: string;
  indexes: string;
}

async function getStorageStats() {
  const [dbSize] = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;

  const tables = await db.$queryRaw<StorageRow[]>`
    SELECT
      c.relname AS name,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
      pg_size_pretty(pg_relation_size(c.oid)) AS data,
      pg_size_pretty(pg_indexes_size(c.oid)) AS indexes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `;

  return { totalSize: dbSize.size, tables };
}

async function getUserStats(userId: string, excludedEmails: string[]) {
  const [
    senderCount,
    messageCount,
    pendingCount,
    imboxCount,
    feedCount,
    paperTrailCount,
    archivedCount,
  ] = await Promise.all([
    db.sender.count({ where: { userId } }),
    db.message.count({ where: { userId } }),
    db.sender.count({
      where: visiblePendingSenderWhere(
        userId,
        excludedEmails.length > 0 ? excludedEmails : null,
      ),
    }),
    db.message.count({ where: { userId, isInImbox: true } }),
    db.message.count({ where: { userId, isInFeed: true } }),
    db.message.count({ where: { userId, isInPaperTrail: true } }),
    db.message.count({ where: { userId, isArchived: true } }),
  ]);

  const folders = await db.folder.findMany({
    where: { userId },
    select: {
      name: true,
      path: true,
      specialUse: true,
      lastSyncedAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { path: "asc" },
  });

  return {
    senderCount,
    messageCount,
    pendingCount,
    imboxCount,
    feedCount,
    paperTrailCount,
    archivedCount,
    folders,
  };
}

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;
  const isAdmin = session.user.role === "ADMIN";

  const [user, rawConnections, rawPasskeys, systemSettings, badgePrefs] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          displayName: true,
          createdAt: true,
          blockRemoteImages: true,
          blockTrackers: true,
        },
      }),
      db.emailConnection.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          email: true,
          displayName: true,
          sendAsEmail: true,
          aliases: true,
          imapHost: true,
          smtpHost: true,
          isDefault: true,
          createdAt: true,
          oauthProvider: true,
          oauthError: true,
          syncState: {
            select: {
              isSyncing: true,
              syncError: true,
              lastFullSync: true,
              lastSyncLog: true,
            },
          },
        },
      }),
      db.passkey.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          friendlyName: true,
          createdAt: true,
          deviceType: true,
          backedUp: true,
        },
      }),
      db.systemSettings.findUnique({ where: { id: "singleton" } }),
      getBadgePreferences(userId),
    ]);

  const canManageConnections =
    isAdmin || (systemSettings?.selfServiceAccountManagement ?? true);

  const excludedEmails = [
    ...new Set(
      rawConnections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];
  const [stats, storage] = await Promise.all([
    getUserStats(userId, excludedEmails),
    isAdmin ? getStorageStats() : null,
  ]);

  const connections: EmailConnection[] = rawConnections.map((c) => ({
    id: c.id,
    email: c.email,
    displayName: c.displayName,
    sendAsEmail: c.sendAsEmail,
    aliases: c.aliases,
    imapHost: c.imapHost,
    smtpHost: c.smtpHost,
    isDefault: c.isDefault,
    createdAt: c.createdAt.toISOString(),
    syncStatus: c.syncState?.isSyncing
      ? "syncing"
      : c.syncState?.syncError
        ? "error"
        : c.syncState?.lastFullSync
          ? "synced"
          : "idle",
    lastSyncedAt: c.syncState?.lastFullSync?.toISOString() ?? null,
    syncError: c.syncState?.syncError ?? null,
    lastSyncLog: c.syncState?.lastSyncLog ?? null,
    oauthProvider: c.oauthProvider ?? null,
    oauthError: c.oauthError ?? null,
  }));

  const passkeys: PasskeyInfo[] = rawPasskeys.map((pk) => ({
    id: pk.id,
    friendlyName: pk.friendlyName ?? "Unknown device",
    createdAt: pk.createdAt.toISOString(),
    deviceType: pk.deviceType as "singleDevice" | "multiDevice",
    backedUp: pk.backedUp,
  }));

  const imagePolicy = resolveImagePolicy({
    blockRemoteImages: user?.blockRemoteImages ?? true,
    blockTrackers: user?.blockTrackers ?? true,
  });

  /* ── Tab content ─────────────────────────────────────────────── */

  const accountContent = (
    <div className="space-y-10 md:space-y-12">
      {/* Profile */}
      <section>
        <SectionHeading eyebrow="Account" title="Profile" />
        <DefinitionList className="mt-4">
          <DisplayNameField currentName={user?.displayName ?? null} />
          <DefinitionRow label="Account created">
            {user?.createdAt.toLocaleDateString()}
          </DefinitionRow>
        </DefinitionList>
      </section>

      {/* Passkeys */}
      <section>
        <SectionHeading
          eyebrow="Security"
          title="Passkeys"
          description={
            passkeys.length === 0
              ? "No passkeys registered"
              : `${passkeys.length} passkey${passkeys.length !== 1 ? "s" : ""} registered`
          }
        />
        <div className="mt-4">
          <PasskeysList passkeys={passkeys} />
        </div>
      </section>

      {/* Notifications */}
      <section>
        <SectionHeading eyebrow="Alerts" title="Notifications" />
        <div className="mt-4">
          <NotificationSettings />
        </div>
      </section>

      {/* Appearance */}
      <section>
        <SectionHeading eyebrow="Display" title="Appearance" />
        <div className="mt-4">
          <ThemeSettings />
        </div>
      </section>

      {/* Badge preferences */}
      <section>
        <SectionHeading eyebrow="Navigation" title="Badge preferences" />
        <div className="mt-4">
          <BadgePreferencesSettings initialPrefs={badgePrefs} />
        </div>
      </section>
    </div>
  );

  const mailContent = (
    <div className="space-y-10 md:space-y-12">
      {/* Email connections */}
      <section>
        <div className="flex items-start justify-between gap-4">
          <SectionHeading eyebrow="Mail" title="Email connections" />
          {canManageConnections && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 text-sm"
            >
              <Link
                href="/setup?mode=add"
                aria-label="Add another email account"
              >
                <PlusCircle className="h-4 w-4" />
                Add account
              </Link>
            </Button>
          )}
        </div>
        <div className="mt-4">
          <ConnectionsList connections={connections} />
        </div>
      </section>

      {/* Privacy — remote image / tracker blocking */}
      <section>
        <SectionHeading
          eyebrow="Privacy"
          title={
            <span className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              Privacy
            </span>
          }
        />
        <div className="mt-4">
          <ImagePrivacySettings initialPolicy={imagePolicy} />
        </div>
      </section>

      {/* Synced folders */}
      {stats.folders.length > 0 && (
        <section>
          <SectionHeading eyebrow="Mail" title="Synced folders" />
          <DefinitionList className="mt-4">
            {stats.folders.map((f) => (
              <DefinitionRow
                key={f.path}
                label={
                  <span className="block min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {f.path}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {f.specialUse || "\u2014"}
                      {f.lastSyncedAt && (
                        <>
                          {" "}
                          &middot; synced{" "}
                          {new Date(f.lastSyncedAt).toLocaleString()}
                        </>
                      )}
                    </span>
                  </span>
                }
              >
                {f._count.messages.toLocaleString()}
              </DefinitionRow>
            ))}
          </DefinitionList>
        </section>
      )}

      {/* Import */}
      <section>
        <SectionHeading
          eyebrow="Mail"
          title="Import"
          description="Import all messages from your IMAP accounts. Progress will appear at the bottom of the screen."
        />
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Resync erases all cached mail and sender decisions, then re-imports
          from IMAP. All senders return to the Screener.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ImportButton />
          <ImportButton mode="resync" />
        </div>
      </section>

      {/* Screener */}
      <section>
        <SectionHeading
          eyebrow="Mail"
          title="Screener"
          description="Auto-approve pending senders whose most recent message is older than 90 days. They go to the Imbox so you only need to manually screen recent senders."
        />
        <div className="mt-4">
          <ScreenRecentButton />
        </div>
      </section>
    </div>
  );

  const systemContent = (
    <div className="space-y-10 md:space-y-12">
      {/* Admin link */}
      {isAdmin && (
        <section>
          <Link
            href="/settings/admin"
            className="group flex items-center justify-between gap-3 border-b border-border py-3.5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Admin settings</p>
                <p className="text-xs text-muted-foreground">
                  Manage users and registration
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
      )}

      {/* Statistics */}
      <section>
        <SectionHeading eyebrow="Overview" title="Statistics" />
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          <Stat
            value={stats.messageCount.toLocaleString()}
            label="Total synced"
          />
          <Stat value={stats.senderCount.toLocaleString()} label="Senders" />
          <Stat value={stats.imboxCount.toLocaleString()} label="Imbox" />
          <Stat value={stats.feedCount.toLocaleString()} label="Feed" />
          <Stat
            value={stats.paperTrailCount.toLocaleString()}
            label="Paper Trail"
          />
          <Stat
            value={stats.archivedCount.toLocaleString()}
            label="Archived"
          />
          <Stat
            value={stats.pendingCount.toLocaleString()}
            label="Pending screening"
          />
        </div>
      </section>

      {/* Storage (admin only) */}
      {storage && (
        <section>
          <SectionHeading eyebrow="Admin" title="Storage" />
          <div className="mt-5">
            <Stat value={storage.totalSize} label="Database size" />
          </div>
          <DefinitionList className="mt-6">
            <div className="flex items-center gap-3 py-2">
              <span className="eyebrow flex-1 text-muted-foreground">
                Table
              </span>
              <span className="eyebrow w-20 text-right text-muted-foreground">
                Total
              </span>
              <span className="eyebrow w-20 text-right text-muted-foreground">
                Data
              </span>
              <span className="eyebrow w-20 text-right text-muted-foreground">
                Indexes
              </span>
            </div>
            {storage.tables.map((t) => (
              <div key={t.name} className="flex items-center gap-3 py-2">
                <span className="flex-1 truncate text-sm font-medium">
                  {t.name}
                </span>
                <span className="w-20 text-right text-sm tabular-nums">
                  {t.total}
                </span>
                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
                  {t.data}
                </span>
                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
                  {t.indexes}
                </span>
              </div>
            ))}
          </DefinitionList>
        </section>
      )}

      {/* Danger zone */}
      <section>
        <SectionHeading
          eyebrow="Danger zone"
          title={<span className="text-destructive">Danger zone</span>}
        />
        <div className="mt-4 divide-y divide-destructive/30 border-y border-destructive/30">
          <div className="py-4">
            <p className="text-sm font-medium">Clear all messages</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Delete all messages, senders, and folders. Your email connections
              are kept — just re-import afterwards.
            </p>
            <div className="mt-3">
              <WipeMailButton />
            </div>
          </div>
          <div className="py-4">
            <p className="text-sm font-medium">Wipe everything</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Delete all email connections, messages, senders, and folders. Your
              account and passkeys are kept. You will be redirected to set up a
              new connection.
            </p>
            <div className="mt-3">
              <WipeButton />
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <PageMasthead eyebrow="Account" title="Settings" />

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl">
          <SettingsTabs
            accountContent={accountContent}
            mailContent={mailContent}
            systemContent={systemContent}
          />
        </div>
      </div>
    </div>
  );
}
