import { db } from "@/lib/db";
import { withImapConnection } from "@/lib/mail/imap-client";
import { patternMatchesDomain } from "@/lib/mail/domain-rules";
import {
  approveSenderForUser,
  rejectSenderForUser,
} from "@/lib/mail/mutations";
import {
  appendToImapSent,
  createLocalSentMessage,
} from "@/lib/mail/persist-sent";
import { deleteMessagesWithTombstones } from "@/lib/mail/tombstones";
import {
  advanceRunAt,
  computeNextRunAt,
  type SettingsBackupCadence,
} from "@/lib/mail/settings-backup-cadence";
import {
  backupsToPrune,
  isSettingsBackupMessage,
  parseSettingsBackup,
  serializeSettingsBackup,
  settingsBackupFilename,
  settingsBackupSubject,
  type SettingsBackupPayload,
  type SettingsBackupSource,
} from "@/lib/mail/settings-backup-payload";

const BACKUP_BODY =
  "This is a Kurir settings snapshot (contacts, screening, and preferences). It is not a letter and contains no email messages.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function defaultConnection(userId: string) {
  const connections = await db.emailConnection.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      sendAsEmail: true,
      isDefault: true,
    },
  });
  return connections[0] ?? null;
}

export async function snapshotSettingsForUser(
  userId: string,
  source: SettingsBackupSource,
): Promise<SettingsBackupPayload> {
  const [user, connections, contacts, groups, senders, rules, subjectRuleRows] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          theme: true,
          timezone: true,
          blockRemoteImages: true,
          blockTrackers: true,
          showImboxBadge: true,
          showScreenerBadge: true,
          showFeedBadge: true,
          showPaperTrailBadge: true,
          showFollowUpBadge: true,
          showReplyLaterBadge: true,
          showScheduledBadge: true,
        },
      }),
      db.emailConnection.findMany({
        where: { userId },
        select: { id: true, email: true },
      }),
      db.contact.findMany({
        where: { userId },
        include: { emails: true },
      }),
      db.contactGroup.findMany({
        where: { userId },
        include: {
          members: { include: { contactEmail: { select: { email: true } } } },
        },
      }),
      db.sender.findMany({
        where: { userId, status: { in: ["APPROVED", "REJECTED"] } },
      }),
      db.domainRule.findMany({ where: { userId } }),
      db.subjectRule.findMany({ where: { userId } }),
    ]);

  if (!user) {
    throw new Error("User not found");
  }

  const connectionEmail = new Map(
    connections.map((c) => [c.id, normalizeEmail(c.email)]),
  );

  return {
    kind: "kurir-settings-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    source,
    preferences: {
      theme: user.theme,
      // The payload schema wants a concrete zone; an account that never
      // chose one renders as UTC everywhere, so that is what it exports.
      timezone: user.timezone ?? "UTC",
      blockRemoteImages: user.blockRemoteImages,
      blockTrackers: user.blockTrackers,
      showImboxBadge: user.showImboxBadge,
      showScreenerBadge: user.showScreenerBadge,
      showFeedBadge: user.showFeedBadge,
      showPaperTrailBadge: user.showPaperTrailBadge,
      showFollowUpBadge: user.showFollowUpBadge,
      showReplyLaterBadge: user.showReplyLaterBadge,
      showScheduledBadge: user.showScheduledBadge,
    },
    contacts: contacts.map((c) => ({
      name: c.name,
      notes: c.notes ?? "",
      emails: c.emails.map((e) => ({
        email: normalizeEmail(e.email),
        label: e.label,
        isPrimary: e.isPrimary,
      })),
    })),
    contactGroups: groups.map((g) => ({
      name: g.name,
      defaultTarget: g.defaultTarget,
      members: g.members.map((m) => normalizeEmail(m.contactEmail.email)),
    })),
    senders: senders
      .filter(
        (
          s,
        ): s is typeof s & { status: "APPROVED" | "REJECTED" } =>
          s.status === "APPROVED" || s.status === "REJECTED",
      )
      .map((s) => ({
        connectionEmail: connectionEmail.get(s.emailConnectionId) ?? "",
        email: normalizeEmail(s.email),
        domain: s.domain,
        status: s.status,
        category: s.category,
        unthread: s.unthread,
        allowRemoteImages: s.allowRemoteImages,
      }))
      .filter((s) => s.connectionEmail !== ""),
    domainRules: rules
      .map((r) => ({
        connectionEmail: connectionEmail.get(r.emailConnectionId) ?? "",
        pattern: r.pattern,
        includeSubdomains: r.includeSubdomains,
        status: r.status as "APPROVED" | "REJECTED",
        category: r.category,
      }))
      .filter((r) => r.connectionEmail !== ""),
    subjectRules: subjectRuleRows
      .map((r) => ({
        connectionEmail: connectionEmail.get(r.emailConnectionId) ?? "",
        scope: r.scope,
        scopeValue: r.scopeValue,
        pattern: r.pattern,
        status: r.status as "APPROVED" | "REJECTED",
        category: r.category,
      }))
      .filter((r) => r.connectionEmail !== ""),
  };
}

export async function writeSettingsBackupForUser(
  userId: string,
  source: SettingsBackupSource,
): Promise<{ messageId: string; appendOk: boolean }> {
  const connection = await defaultConnection(userId);
  if (!connection) {
    throw new Error("No email connection");
  }

  const sentFolder = await db.folder.findFirst({
    where: { emailConnectionId: connection.id, specialUse: "sent" },
    select: { id: true },
  });
  if (!sentFolder) {
    throw new Error("No Sent folder");
  }

  const snapshot = await snapshotSettingsForUser(userId, source);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const timezone = user?.timezone || "UTC";
  const now = new Date();
  const filename = settingsBackupFilename(now, timezone);
  const subject = settingsBackupSubject(now, timezone);
  const json = serializeSettingsBackup(snapshot);
  const content = Buffer.from(json, "utf8");
  const fromAddress = connection.sendAsEmail || connection.email;

  const attachment = await db.attachment.create({
    data: {
      filename,
      contentType: "application/json",
      size: content.length,
      content,
      userId,
    },
  });

  const message = await createLocalSentMessage({
    userId,
    emailConnectionId: connection.id,
    messageId: `<kurir-settings-backup-${Date.now()}@kurir.local>`,
    threadId: null,
    inReplyTo: null,
    references: [],
    subject,
    fromAddress,
    toAddresses: [fromAddress],
    text: BACKUP_BODY,
    html: null,
    attachmentIds: [attachment.id],
  });

  if (!message) {
    throw new Error("No Sent folder");
  }

  let appendOk = false;
  try {
    appendOk =
      (await appendToImapSent({
        emailConnectionId: connection.id,
        messageId: message.messageId,
        inReplyTo: null,
        references: [],
        subject,
        fromAddress,
        toAddresses: [fromAddress],
        text: BACKUP_BODY,
        attachments: [
          {
            filename,
            content,
            contentType: "application/json",
          },
        ],
      })) === true;
  } catch (err) {
    appendOk = false;
    console.error("[settings-backup] IMAP APPEND failed:", err);
  }
  if (!appendOk) {
    console.error(
      "[settings-backup] IMAP APPEND did not land; backup will not survive a wipe",
    );
  }

  await pruneOldBackups(userId);
  return { messageId: message.id, appendOk };
}

async function pruneOldBackups(userId: string) {
  const listed = await listSettingsBackupsForUser(userId);
  const victims = backupsToPrune(listed);
  for (const victim of victims) {
    const row = await db.message.findFirst({
      where: { id: victim.messageId, userId },
      select: {
        id: true,
        uid: true,
        emailConnectionId: true,
        folder: { select: { path: true } },
      },
    });
    if (!row) continue;

    if (row.uid > 0 && row.folder) {
      const deleted = await deleteImapUid({
        emailConnectionId: row.emailConnectionId,
        folderPath: row.folder.path,
        uid: row.uid,
      });
      if (!deleted) continue;
    }

    await deleteMessagesWithTombstones({ id: row.id, userId });
  }
}

async function deleteImapUid(opts: {
  emailConnectionId: string;
  folderPath: string;
  uid: number;
}): Promise<boolean> {
  const result = await withImapConnection(
    opts.emailConnectionId,
    async (client) => {
      const lock = await client.getMailboxLock(opts.folderPath);
      try {
        await client.messageDelete(String(opts.uid), { uid: true });
        return true;
      } finally {
        lock.release();
      }
    },
  );
  return result === true;
}

export type SettingsBackupListItem = {
  messageId: string;
  sentAt: Date;
  filename: string;
  source: SettingsBackupSource | null;
};

export async function listSettingsBackupsForUser(
  userId: string,
): Promise<SettingsBackupListItem[]> {
  const messages = await db.message.findMany({
    where: {
      userId,
      hasAttachments: true,
      subject: { startsWith: "Kurir settings backup - " },
      folder: { specialUse: "sent" },
    },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      sentAt: true,
      subject: true,
      attachments: { select: { filename: true, content: true } },
    },
  });

  const items: SettingsBackupListItem[] = [];
  for (const message of messages) {
    const filenames = message.attachments.map((a) => a.filename);
    if (!isSettingsBackupMessage(message.subject, filenames)) continue;
    const file =
      message.attachments.find((a) =>
        /^kurir-settings-.*\.json$/.test(a.filename),
      ) ?? message.attachments[0];
    let source: SettingsBackupSource | null = null;
    if (file?.content) {
      try {
        const parsed = parseSettingsBackup(
          Buffer.from(file.content).toString("utf8"),
        );
        source = parsed.source;
      } catch {
        source = null;
      }
    }
    items.push({
      messageId: message.id,
      sentAt: message.sentAt ?? new Date(),
      filename: file?.filename ?? "kurir-settings.json",
      source,
    });
  }
  return items;
}

export async function applySettingsBackupForUser(
  userId: string,
  payload: SettingsBackupPayload,
): Promise<{ skippedConnections: string[] }> {
  parseSettingsBackup(payload);

  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { id: true, email: true },
  });
  const byEmail = new Map(
    connections.map((c) => [normalizeEmail(c.email), c]),
  );

  const mentioned = new Set<string>();
  for (const s of payload.senders) mentioned.add(normalizeEmail(s.connectionEmail));
  for (const r of payload.domainRules) {
    mentioned.add(normalizeEmail(r.connectionEmail));
  }
  for (const r of payload.subjectRules) {
    mentioned.add(normalizeEmail(r.connectionEmail));
  }
  const skippedConnections = [...mentioned].filter((e) => !byEmail.has(e));

  const restoredSenderIds: Array<{
    id: string;
    status: "APPROVED" | "REJECTED";
    category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
  }> = [];
  const restoredRules: Array<{
    emailConnectionId: string;
    pattern: string;
    includeSubdomains: boolean;
    status: "APPROVED" | "REJECTED";
    category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
  }> = [];

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        theme: payload.preferences.theme,
        timezone: payload.preferences.timezone,
        blockRemoteImages: payload.preferences.blockRemoteImages,
        blockTrackers: payload.preferences.blockTrackers,
        showImboxBadge: payload.preferences.showImboxBadge,
        showScreenerBadge: payload.preferences.showScreenerBadge,
        showFeedBadge: payload.preferences.showFeedBadge,
        showPaperTrailBadge: payload.preferences.showPaperTrailBadge,
        showFollowUpBadge: payload.preferences.showFollowUpBadge,
        showReplyLaterBadge: payload.preferences.showReplyLaterBadge,
        showScheduledBadge: payload.preferences.showScheduledBadge,
      },
    });

    for (const contact of payload.contacts) {
      const emails = contact.emails.map((e) => ({
        ...e,
        email: normalizeEmail(e.email),
      }));
      const existing = await tx.contactEmail.findFirst({
        where: {
          email: { in: emails.map((e) => e.email) },
          contact: { userId },
        },
        select: { contactId: true },
      });

      let contactId: string;
      if (existing) {
        contactId = existing.contactId;
        await tx.contact.update({
          where: { id: contactId },
          data: { name: contact.name, notes: contact.notes || null },
        });
      } else {
        const created = await tx.contact.create({
          data: {
            name: contact.name,
            notes: contact.notes || null,
            userId,
          },
        });
        contactId = created.id;
      }

      for (const email of emails) {
        const have = await tx.contactEmail.findFirst({
          where: { contactId, email: email.email },
        });
        if (!have) {
          await tx.contactEmail.create({
            data: {
              contactId,
              email: email.email,
              label: email.label || "personal",
              isPrimary: email.isPrimary,
            },
          });
        }
      }
    }

    for (const group of payload.contactGroups) {
      let row = await tx.contactGroup.findFirst({
        where: { userId, name: group.name },
      });
      if (!row) {
        row = await tx.contactGroup.create({
          data: {
            userId,
            name: group.name,
            defaultTarget: group.defaultTarget,
          },
        });
      } else {
        await tx.contactGroup.update({
          where: { id: row.id },
          data: { defaultTarget: group.defaultTarget },
        });
      }

      const memberEmails = group.members.map(normalizeEmail);
      const memberRows = await tx.contactEmail.findMany({
        where: { email: { in: memberEmails }, contact: { userId } },
        select: { id: true },
      });
      await tx.contactGroupMember.deleteMany({ where: { groupId: row.id } });
      if (memberRows.length > 0) {
        await tx.contactGroupMember.createMany({
          data: memberRows.map((m) => ({
            groupId: row.id,
            contactEmailId: m.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    for (const rule of payload.domainRules) {
      const connection = byEmail.get(normalizeEmail(rule.connectionEmail));
      if (!connection) continue;
      await tx.domainRule.upsert({
        where: {
          emailConnectionId_pattern_includeSubdomains: {
            emailConnectionId: connection.id,
            pattern: rule.pattern,
            includeSubdomains: rule.includeSubdomains,
          },
        },
        create: {
          emailConnectionId: connection.id,
          userId,
          pattern: rule.pattern,
          includeSubdomains: rule.includeSubdomains,
          status: rule.status,
          category: rule.category,
        },
        update: { status: rule.status, category: rule.category },
      });
      restoredRules.push({
        emailConnectionId: connection.id,
        pattern: rule.pattern,
        includeSubdomains: rule.includeSubdomains,
        status: rule.status,
        category: rule.category,
      });
    }

    // Subject rules are restored as configuration only: new mail follows
    // them at ingest, but no message-level retroactive sweep runs here
    // (unlike createSubjectRuleForUser, which sweeps on user-driven create).
    for (const rule of payload.subjectRules) {
      const connection = byEmail.get(normalizeEmail(rule.connectionEmail));
      if (!connection) continue;
      await tx.subjectRule.upsert({
        where: {
          emailConnectionId_scope_scopeValue_pattern: {
            emailConnectionId: connection.id,
            scope: rule.scope,
            scopeValue: rule.scopeValue,
            pattern: rule.pattern,
          },
        },
        create: {
          emailConnectionId: connection.id,
          userId,
          scope: rule.scope,
          scopeValue: rule.scopeValue,
          pattern: rule.pattern,
          status: rule.status,
          category: rule.category,
        },
        update: { status: rule.status, category: rule.category },
      });
    }

    for (const sender of payload.senders) {
      const connection = byEmail.get(normalizeEmail(sender.connectionEmail));
      if (!connection) continue;
      const email = normalizeEmail(sender.email);
      const existing = await tx.sender.findFirst({
        where: { emailConnectionId: connection.id, email },
      });
      const data = {
        status: sender.status,
        category: sender.status === "REJECTED" ? null : sender.category,
        unthread: sender.unthread,
        allowRemoteImages: sender.allowRemoteImages,
        decidedAt: new Date(),
      };
      if (existing) {
        await tx.sender.update({
          where: { id: existing.id },
          data,
        });
        restoredSenderIds.push({
          id: existing.id,
          status: sender.status,
          category: sender.category,
        });
      } else {
        const created = await tx.sender.create({
          data: {
            email,
            domain: sender.domain,
            userId,
            emailConnectionId: connection.id,
            ...data,
          },
        });
        restoredSenderIds.push({
          id: created.id,
          status: sender.status,
          category: sender.category,
        });
      }
    }
  });

  const pending = await db.sender.findMany({
    where: { userId, status: "PENDING" },
    select: { id: true, domain: true, emailConnectionId: true },
  });
  for (const rule of restoredRules) {
    const matching = pending.filter(
      (s) =>
        s.emailConnectionId === rule.emailConnectionId &&
        patternMatchesDomain(s.domain, rule),
    );
    for (const s of matching) {
      if (rule.status === "APPROVED" && rule.category) {
        await approveSenderForUser(userId, s.id, rule.category);
      } else if (rule.status === "REJECTED") {
        await rejectSenderForUser(userId, s.id);
      }
    }
  }

  for (const sender of restoredSenderIds) {
    if (sender.status === "APPROVED" && sender.category) {
      await approveSenderForUser(userId, sender.id, sender.category);
    } else if (sender.status === "REJECTED") {
      await rejectSenderForUser(userId, sender.id);
    }
  }

  return { skippedConnections };
}

export async function restoreSettingsBackupFromMessageForUser(
  userId: string,
  messageId: string,
): Promise<{ skippedConnections: string[] }> {
  const message = await db.message.findFirst({
    where: { id: messageId, userId, folder: { specialUse: "sent" } },
    include: { attachments: true },
  });
  if (!message) {
    throw new Error("Backup not found");
  }

  const file = message.attachments.find((a) =>
    /^kurir-settings-.*\.json$/.test(a.filename),
  );
  if (!file) {
    throw new Error("Backup attachment not found");
  }

  let raw: string | null = file.content
    ? Buffer.from(file.content).toString("utf8")
    : null;
  if (!raw) {
    const { loadAttachmentsForSend } = await import(
      "@/lib/mail/attachment-helpers"
    );
    const loaded = await loadAttachmentsForSend([file.id], userId);
    raw = loaded.sentAttachments[0]?.content.toString("utf8") ?? null;
  }
  if (!raw) {
    throw new Error("Could not read backup attachment");
  }

  const parsed = parseSettingsBackup(raw);
  return applySettingsBackupForUser(userId, parsed);
}

export async function setSettingsBackupCadenceForUser(
  userId: string,
  cadence: SettingsBackupCadence,
): Promise<Date | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const timezone = user?.timezone || "UTC";
  const nextRunAt = computeNextRunAt({
    now: new Date(),
    timezone,
    cadence,
  });
  await db.user.update({
    where: { id: userId },
    data: {
      settingsBackupCadence: cadence,
      settingsBackupNextRunAt: nextRunAt,
    },
  });
  return nextRunAt;
}

export async function processDueSettingsBackups(): Promise<void> {
  const due = await db.user.findMany({
    where: {
      settingsBackupCadence: { in: ["daily", "weekly"] },
      settingsBackupNextRunAt: { lte: new Date() },
    },
    select: {
      id: true,
      timezone: true,
      settingsBackupCadence: true,
      settingsBackupNextRunAt: true,
    },
  });

  for (const user of due) {
    try {
      const result = await writeSettingsBackupForUser(user.id, "scheduled");
      if (!result.appendOk) continue;
      const cadence = user.settingsBackupCadence;
      if (cadence !== "daily" && cadence !== "weekly") continue;
      const slot = user.settingsBackupNextRunAt ?? new Date();
      const next = advanceRunAt({
        slot,
        timezone: user.timezone || "UTC",
        cadence,
      });
      await db.user.update({
        where: { id: user.id },
        data: { settingsBackupNextRunAt: next },
      });
    } catch (err) {
      console.error(`[settings-backup] write failed for ${user.id}:`, err);
    }
  }
}
