#!/usr/bin/env npx tsx
/**
 * Export one user's Kurir state for the standalone app (kurir-core, plan 058).
 * The core imports the JSON with `import_state`, writes it to the Kurir/State
 * log on the next sync, and every device picks it up from there.
 *
 * Mail itself is not exported: it already lives in the mailbox. Pins are IMAP
 * flags, so they are not exported either. Per-message state (snooze, reply
 * later, follow-up, AI verdicts) is keyed by RFC Message-ID, which is what the
 * core keys it by.
 *
 * Usage:
 *   pnpm tsx scripts/export-kurir-state.ts <user email> > kurir-state.json
 */

try {
  await import("dotenv/config");
} catch {}
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("usage: export-kurir-state.ts <user email>");
    process.exit(1);
  }
  const connection = await db.emailConnection.findFirst({
    where: { email },
    include: { user: true },
  });
  if (!connection) {
    console.error(`no email connection for ${email}`);
    process.exit(1);
  }
  const { user } = connection;
  const userId = user.id;
  const connectionId = connection.id;

  const senders = await db.sender.findMany({
    where: {
      emailConnectionId: connectionId,
      OR: [{ status: { not: "PENDING" } }, { skippedUntil: { not: null } }],
    },
    select: {
      email: true,
      status: true,
      category: true,
      unthread: true,
      allowRemoteImages: true,
      skippedUntil: true,
    },
  });
  const domainRules = await db.domainRule.findMany({
    where: { emailConnectionId: connectionId },
    select: { pattern: true, includeSubdomains: true, status: true, category: true },
  });
  const subjectRules = await db.subjectRule.findMany({
    where: { emailConnectionId: connectionId },
    select: { scope: true, scopeValue: true, pattern: true, status: true, category: true },
  });
  const contentRules = await db.contentRule.findMany({
    where: { userId, OR: [{ emailConnectionId: null }, { emailConnectionId: connectionId }] },
    select: {
      id: true,
      criterion: true,
      onMatch: true,
      onNoMatch: true,
      senders: { select: { scope: true, scopeValue: true, since: true } },
      matches: {
        select: {
          matched: true,
          reason: true,
          appliedAction: true,
          message: { select: { messageId: true } },
        },
      },
    },
  });
  const messages = await db.message.findMany({
    where: {
      emailConnectionId: connectionId,
      messageId: { not: null },
      OR: [{ isSnoozed: true }, { isReplyLater: true }, { followUpAt: { not: null } }],
    },
    select: {
      messageId: true,
      isSnoozed: true,
      snoozedUntil: true,
      isReplyLater: true,
      followUpAt: true,
    },
  });
  const groups = await db.contactGroup.findMany({
    where: { userId },
    select: {
      name: true,
      defaultTarget: true,
      members: {
        select: {
          contactEmail: { select: { email: true, contact: { select: { name: true } } } },
        },
      },
    },
  });

  const out = {
    format: "kurir-state-export/1",
    exportedAt: new Date().toISOString(),
    account: {
      email: connection.email,
      displayName: connection.displayName,
      sendAsEmail: connection.sendAsEmail,
      aliases: connection.aliases,
      treatDomainAsOwn: connection.treatDomainAsOwn,
    },
    senders: senders.map((s) => ({
      email: s.email,
      status: s.status,
      category: s.category,
      unthread: s.unthread,
      allowRemoteImages: s.allowRemoteImages,
      skippedUntil: s.skippedUntil?.toISOString() ?? null,
    })),
    domainRules,
    subjectRules,
    contentRules: contentRules.map((r) => ({
      id: r.id,
      criterion: r.criterion,
      onMatch: r.onMatch,
      onNoMatch: r.onNoMatch,
      senders: r.senders.map((s) => ({
        scope: s.scope,
        scopeValue: s.scopeValue,
        since: s.since.toISOString(),
      })),
    })),
    verdicts: contentRules.flatMap((r) =>
      r.matches
        .filter((m) => m.message.messageId)
        .map((m) => ({
          messageId: m.message.messageId,
          ruleId: r.id,
          matched: m.matched,
          reason: m.reason ?? "",
          appliedAction: m.appliedAction,
          criterion: r.criterion,
        })),
    ),
    snoozes: messages
      .filter((m) => m.isSnoozed)
      .map((m) => ({ messageId: m.messageId, until: m.snoozedUntil?.toISOString() ?? null })),
    replyLater: messages.filter((m) => m.isReplyLater).map((m) => m.messageId),
    followUps: messages
      .filter((m) => m.followUpAt)
      .map((m) => ({ messageId: m.messageId, at: m.followUpAt!.toISOString() })),
    settings: {
      imagePolicy: user.blockRemoteImages
        ? "BLOCK_ALL"
        : user.blockTrackers
          ? "BLOCK_TRACKERS"
          : "ALLOW_ALL",
      theme: user.theme,
      calendarAvailability: user.calendarAvailability ?? null,
    },
    contactGroups: groups.map((g) => ({
      name: g.name,
      defaultTarget: g.defaultTarget,
      members: g.members.map((m) => ({
        email: m.contactEmail.email,
        name: m.contactEmail.contact.name || null,
      })),
    })),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  console.error(
    `exported ${out.senders.length} senders, ${domainRules.length} domain rules, ${subjectRules.length} subject rules, ` +
      `${contentRules.length} AI rules with ${out.verdicts.length} verdicts, ${out.snoozes.length} snoozes, ` +
      `${out.replyLater.length} reply later, ${out.followUps.length} follow-ups, ${groups.length} contact groups`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
