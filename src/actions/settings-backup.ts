"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  isSettingsBackupCadence,
  type SettingsBackupCadence,
} from "@/lib/mail/settings-backup-cadence";
import {
  listSettingsBackupsForUser,
  restoreSettingsBackupFromMessageForUser,
  setSettingsBackupCadenceForUser,
  writeSettingsBackupForUser,
  type SettingsBackupListItem,
} from "@/lib/mail/settings-backup";

export type SettingsBackupState = {
  cadence: SettingsBackupCadence;
  nextRunAt: string | null;
  timezone: string;
  backups: Array<{
    messageId: string;
    sentAt: string;
    filename: string;
    source: SettingsBackupListItem["source"];
  }>;
};

export async function getSettingsBackupState(): Promise<SettingsBackupState> {
  const session = await requireAuth();
  const userId = session.user.id;
  const [user, backups] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        settingsBackupCadence: true,
        settingsBackupNextRunAt: true,
        timezone: true,
      },
    }),
    listSettingsBackupsForUser(userId),
  ]);

  const raw = user?.settingsBackupCadence ?? "off";
  const cadence: SettingsBackupCadence = isSettingsBackupCadence(raw)
    ? raw
    : "off";

  return {
    cadence,
    nextRunAt: user?.settingsBackupNextRunAt?.toISOString() ?? null,
    timezone: user?.timezone || "UTC",
    backups: backups.map((b) => ({
      messageId: b.messageId,
      sentAt: b.sentAt.toISOString(),
      filename: b.filename,
      source: b.source,
    })),
  };
}

export async function backupSettingsNow(): Promise<{
  appendOk: boolean;
  warning?: string;
}> {
  const session = await requireAuth();
  const result = await writeSettingsBackupForUser(session.user.id, "manual");
  revalidatePath("/settings");
  return {
    appendOk: result.appendOk,
    warning: result.appendOk
      ? undefined
      : "Saved in Sent, but it will not survive a wipe until IMAP accepts a copy.",
  };
}

export async function setSettingsBackupCadence(cadence: string): Promise<{
  nextRunAt: string | null;
}> {
  const session = await requireAuth();
  if (!isSettingsBackupCadence(cadence)) {
    throw new Error("Invalid cadence");
  }
  const next = await setSettingsBackupCadenceForUser(session.user.id, cadence);
  return { nextRunAt: next?.toISOString() ?? null };
}

export async function restoreSettingsBackup(messageId: string): Promise<{
  skippedConnections: string[];
}> {
  const session = await requireAuth();
  if (!messageId.trim()) {
    throw new Error("Backup not found");
  }
  const result = await restoreSettingsBackupFromMessageForUser(
    session.user.id,
    messageId,
  );
  revalidatePath("/", "layout");
  return result;
}
