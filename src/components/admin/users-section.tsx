"use client";

import { AdminPanel } from "@/components/settings/admin-panel";
import { InvitesPanel } from "@/components/admin/invites-panel";
import { UserConnectionsPanel } from "@/components/admin/user-connections-panel";

interface UserData {
  id: string;
  displayName: string | null;
  role: "ADMIN" | "USER";
  createdAt: string;
  emailConnectionCount: number;
}

interface ConnectionData {
  id: string;
  email: string;
  displayName: string | null;
  imapHost: string;
  smtpHost: string;
  isDefault: boolean;
  createdAt: string;
  syncState: {
    isSyncing: boolean;
    syncError: string | null;
    lastFullSync: string | null;
    lastSyncLog: string | null;
  } | null;
}

interface InviteData {
  id: string;
  token: string;
  displayName: string;
  emailHint: string | null;
  expiresAt: string;
  createdAt: string;
}

interface UsersSectionProps {
  currentUserId: string;
  signupsEnabled: boolean;
  selfServiceAccountManagement: boolean;
  users: UserData[];
  invites: InviteData[];
  usersWithConnections: {
    id: string;
    displayName: string | null;
    connections: ConnectionData[];
  }[];
}

export function UsersSection({
  currentUserId,
  signupsEnabled,
  selfServiceAccountManagement,
  users,
  invites,
  usersWithConnections,
}: UsersSectionProps) {
  return (
    <div className="space-y-6 md:space-y-8">
      <AdminPanel
        currentUserId={currentUserId}
        signupsEnabled={signupsEnabled}
        selfServiceAccountManagement={selfServiceAccountManagement}
        users={users}
      />

      <InvitesPanel invites={invites} />

      <UserConnectionsPanel users={usersWithConnections} />
    </div>
  );
}
