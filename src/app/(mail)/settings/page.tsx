import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ImportButton } from "@/components/mail/import-button";
import { visiblePendingSenderWhere } from "@/lib/mail/pending-senders";
import { ConnectionsList } from "@/components/settings/connections-list";
import { PasskeysList } from "@/components/settings/passkeys-list";
import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EmailConnection } from "@/components/settings/connection-card";
import type { PasskeyInfo } from "@/components/settings/passkey-card";
import { WipeButton, WipeMailButton } from "@/components/settings/wipe-button";
import { ScreenRecentButton } from "@/components/settings/screen-recent-button";

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

  // Get folder-level sync debug info
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

  const [user, rawConnections, rawPasskeys] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        createdAt: true,
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
        syncState: {
          select: {
            isSyncing: true,
            syncError: true,
            lastFullSync: true,
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
  ]);

  const excludedEmails = [
    ...new Set(
      rawConnections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];
  const stats = await getUserStats(userId, excludedEmails);

  // Shape connections for the client component (dates must be strings)
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
  }));

  // Shape passkeys for the client component
  const passkeys: PasskeyInfo[] = rawPasskeys.map((pk) => ({
    id: pk.id,
    friendlyName: pk.friendlyName ?? "Unknown device",
    createdAt: pk.createdAt.toISOString(),
    deviceType: pk.deviceType as "singleDevice" | "multiDevice",
    backedUp: pk.backedUp,
  }));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-6 md:space-y-8">

          {/* Account section */}
          <section>
            <h2 className="text-lg font-medium">Account</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <dl className="space-y-3">
                {user?.displayName && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-muted-foreground">Display name</dt>
                    <dd className="text-sm font-medium">{user.displayName}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-sm text-muted-foreground">Account created</dt>
                  <dd className="text-sm font-medium">
                    {user?.createdAt.toLocaleDateString()}
                  </dd>
                </div>
              </dl>

              {/* Passkeys sub-section */}
              <div className="mt-4 border-t pt-4">
                <div className="mb-3">
                  <p className="text-sm font-medium">Passkeys</p>
                  <p className="text-xs text-muted-foreground">
                    {passkeys.length === 0
                      ? "No passkeys registered"
                      : `${passkeys.length} passkey${passkeys.length !== 1 ? "s" : ""} registered`}
                  </p>
                </div>
                <PasskeysList passkeys={passkeys} />
              </div>
            </div>
          </section>

          {/* Email connections section */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Email connections</h2>
              <Button asChild variant="ghost" size="sm" className="gap-1.5 text-sm">
                <Link href="/setup?mode=add" aria-label="Add another email account">
                  <PlusCircle className="h-4 w-4" />
                  Add account
                </Link>
              </Button>
            </div>

            <div className="mt-4">
              <ConnectionsList connections={connections} />
            </div>
          </section>

          {/* Stats */}
          <section>
            <h2 className="text-lg font-medium">Statistics</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.messageCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total synced</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.senderCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Senders</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.imboxCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Imbox</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.feedCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Feed</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.paperTrailCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Paper Trail</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.archivedCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Archived</div>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center">
                <div className="text-2xl font-bold">{stats.pendingCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Pending screening</div>
              </div>
            </div>
          </section>

          {/* Synced folders */}
          {stats.folders.length > 0 && (
            <section>
              <h2 className="text-lg font-medium">Synced folders</h2>
              <div className="mt-4 rounded-lg border bg-card divide-y">
                {stats.folders.map((f) => (
                  <div key={f.path} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.path}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.specialUse || "—"}
                        {f.lastSyncedAt && (
                          <> · synced {new Date(f.lastSyncedAt).toLocaleString()}</>
                        )}
                      </p>
                    </div>
                    <div className="text-sm font-medium tabular-nums">
                      {f._count.messages.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Import */}
          <section>
            <h2 className="text-lg font-medium">Import</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Import all messages from your IMAP accounts. Progress will appear
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

          {/* Screener */}
          <section>
            <h2 className="text-lg font-medium">Screener</h2>
            <div className="mt-4 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Auto-approve pending senders whose most recent message is
                older than 90 days. They go to the Imbox so you only need
                to manually screen recent senders.
              </p>
              <div className="mt-4">
                <ScreenRecentButton />
              </div>
            </div>
          </section>

          {/* Danger zone */}
          <section>
            <h2 className="text-lg font-medium text-destructive">
              Danger zone
            </h2>
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-destructive/30 bg-card p-4">
                <p className="text-sm font-medium">Clear all messages</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Delete all messages, senders, and folders. Your email
                  connections are kept — just re-import afterwards.
                </p>
                <div className="mt-3">
                  <WipeMailButton />
                </div>
              </div>
              <div className="rounded-lg border border-destructive/30 bg-card p-4">
                <p className="text-sm font-medium">Wipe everything</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Delete all email connections, messages, senders, and folders.
                  Your account and passkeys are kept. You will be redirected to
                  set up a new connection.
                </p>
                <div className="mt-3">
                  <WipeButton />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
