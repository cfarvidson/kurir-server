import { after } from "next/server";
import { db } from "@/lib/db";
import {
  moveToArchiveViaImap,
  moveToInboxViaImap,
} from "@/lib/mail/archive-imap";
import { findOrCreateContactForEmail } from "@/lib/mail/contacts";
import { patternMatchesDomain } from "@/lib/mail/domain-rules";
import { scopeMatchesSender } from "@/lib/mail/subject-rules";
import {
  SenderCategory,
  SenderStatus,
  SubjectRuleScope,
} from "@prisma/client";

/**
 * Shared mutation cores for message/sender operations.
 *
 * These functions contain the DB + deferred-IMAP logic behind the server
 * actions in src/actions/* and the mobile batch endpoint /api/mobile/actions.
 * They take an explicit userId (already authenticated by the caller) and do
 * NOT touch the cache layer — web wrappers own updateTag/revalidatePath.
 *
 * All operations are idempotent: applying one twice yields the same state.
 */

// Flags applied when archiving a message. Clears every "placement" flag so an
// archived thread cannot linger in Imbox/Feed/Paper Trail/Screener/Snoozed/
// Reply Later/Follow Up.
export const ARCHIVE_CLEAR_DATA = {
  isArchived: true,
  isInImbox: false,
  isInFeed: false,
  isInPaperTrail: false,
  isInScreener: false,
  isSnoozed: false,
  snoozedUntil: null,
  isReplyLater: false,
  isFollowUp: false,
  followUpAt: null,
  followUpSetAt: null,
};

/**
 * Find PENDING senders linked to the given messages. If all of a sender's
 * messages are now archived, auto-reject the sender so they don't
 * reappear in the Screener when new mail arrives.
 */
export async function autoRejectFullyArchivedSenders(messageIds: string[]) {
  const affectedMessages = await db.message.findMany({
    where: { id: { in: messageIds }, senderId: { not: null } },
    select: { senderId: true },
    distinct: ["senderId"],
  });

  const senderIds = affectedMessages
    .map((m) => m.senderId)
    .filter((id): id is string => id !== null);

  if (senderIds.length === 0) return;

  // Single query: find which senders still have non-archived messages
  const sendersWithNonArchived = await db.message.findMany({
    where: {
      senderId: { in: senderIds },
      isArchived: false,
    },
    select: { senderId: true },
    distinct: ["senderId"],
  });

  const keepSet = new Set(sendersWithNonArchived.map((m) => m.senderId));
  const rejectIds = senderIds.filter((id) => !keepSet.has(id));

  if (rejectIds.length > 0) {
    await db.sender.updateMany({
      where: { id: { in: rejectIds }, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
  }
}

/** Resolve the target message + all messages in its thread. */
async function findThreadMessages(userId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      emailConnectionId: true,
      uid: true,
      folderId: true,
      sender: { select: { category: true } },
    },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: message.uid, folderId: message.folderId }];

  return { message, threadMessages };
}

/** Archive a whole thread. DB update now, IMAP move deferred via after(). */
export async function archiveThread(userId: string, messageId: string) {
  const { message, threadMessages } = await findThreadMessages(
    userId,
    messageId,
  );
  const connectionId = message.emailConnectionId;

  const inboxFolder = await db.folder.findFirst({
    where: { emailConnectionId: connectionId, specialUse: "inbox" },
    select: { id: true },
  });

  const inboxMessageUids = inboxFolder
    ? threadMessages
        .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  const messageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: ARCHIVE_CLEAR_DATA,
  });

  await autoRejectFullyArchivedSenders(messageIds);

  if (inboxMessageUids.length > 0 && inboxFolder) {
    after(() =>
      moveToArchiveViaImap(
        userId,
        connectionId,
        inboxFolder.id,
        inboxMessageUids,
      ).catch((err) => console.error("IMAP archive move failed:", err)),
    );
  }
}

/**
 * Unarchive a whole thread, re-deriving category placement from the sender.
 * Snooze/reply-later/follow-up state cleared on archive is intentionally not
 * restored (consistent with historical behavior).
 */
export async function unarchiveThread(userId: string, messageId: string) {
  const { message, threadMessages } = await findThreadMessages(
    userId,
    messageId,
  );
  const connectionId = message.emailConnectionId;

  const category = message.sender?.category ?? "IMBOX";

  const archiveFolder = await db.folder.findFirst({
    where: {
      emailConnectionId: connectionId,
      specialUse: { in: ["archive", "all"] },
    },
    select: { id: true },
  });

  const archiveMessageUids = archiveFolder
    ? threadMessages
        .filter((m) => m.folderId === archiveFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  const messageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isArchived: false,
      isInImbox: category === "IMBOX",
      isInFeed: category === "FEED",
      isInPaperTrail: category === "PAPER_TRAIL",
      isInScreener: false,
    },
  });

  if (archiveMessageUids.length > 0 && archiveFolder) {
    after(() =>
      moveToInboxViaImap(
        userId,
        connectionId,
        archiveFolder.id,
        archiveMessageUids,
      ).catch((err) => console.error("IMAP unarchive move failed:", err)),
    );
  }

  return { category };
}

/** Set read state for a whole thread (explicit target state — idempotent). */
export async function setThreadReadState(
  userId: string,
  messageId: string,
  isRead: boolean,
) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { isRead },
  });
}

/**
 * Snooze a whole thread. Read state is left untouched so a message returns
 * with its true read state when it wakes.
 */
export async function snoozeThread(
  userId: string,
  messageId: string,
  until: Date,
) {
  if (until <= new Date()) {
    throw new Error("Snooze date must be in the future");
  }

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { isSnoozed: true, snoozedUntil: until },
  });
}

/** Unsnooze a whole thread. Read state preserved. */
export async function unsnoozeThread(userId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { isSnoozed: false, snoozedUntil: null },
  });
}

/**
 * Set a follow-up deadline for a whole thread. `isFollowUp` stays false — the
 * maintenance job flips it to true once the deadline passes, so the Follow-up
 * list shows only overdue threads.
 */
export async function setThreadFollowUp(
  userId: string,
  messageId: string,
  until: Date,
) {
  if (until <= new Date()) {
    throw new Error("Follow-up date must be in the future");
  }

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { followUpAt: until, followUpSetAt: new Date(), isFollowUp: false },
  });
}

/** Clear any follow-up state for a whole thread. */
export async function dismissThreadFollowUp(userId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { followUpAt: null, followUpSetAt: null, isFollowUp: false },
  });
}

/** Toggle the Reply Later flag for a whole thread (explicit target state). */
export async function setThreadReplyLater(
  userId: string,
  messageId: string,
  isReplyLater: boolean,
) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) throw new Error("Message not found");

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true },
      })
    : [{ id: message.id }];

  await db.message.updateMany({
    where: { id: { in: threadMessages.map((m) => m.id) } },
    data: { isReplyLater },
  });
}

/** Approve a sender into a category and move their non-archived messages. */
export async function approveSenderForUser(
  userId: string,
  senderId: string,
  category: SenderCategory,
) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "APPROVED",
        category,
        decidedAt: new Date(),
      },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);

  // Auto-create contact for approved sender
  const approvedSender = await db.sender.findUnique({
    where: { id: senderId },
    select: { email: true, displayName: true },
  });
  if (approvedSender) {
    await findOrCreateContactForEmail(
      userId,
      approvedSender.email,
      approvedSender.displayName,
    );
  }
}

/** Reject a sender: archive their mail and mark REJECTED. IMAP deferred. */
export async function rejectSenderForUser(userId: string, senderId: string) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, emailConnectionId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  // Fetch inbox UIDs for IMAP move (parallelize independent queries)
  const [inboxMessages, inboxFolder] = await Promise.all([
    db.message.findMany({
      where: { senderId, isArchived: false, uid: { gt: 0 } },
      select: { uid: true, folderId: true },
    }),
    db.folder.findFirst({
      where: {
        emailConnectionId: sender.emailConnectionId,
        specialUse: "inbox",
      },
      select: { id: true },
    }),
  ]);

  const inboxUids = inboxFolder
    ? inboxMessages
        .filter((m) => m.folderId === inboxFolder.id)
        .map((m) => m.uid)
    : [];

  // Reject sender + archive messages (instead of limbo)
  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
      },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: true,
        isSnoozed: false,
        snoozedUntil: null,
      },
    }),
  ]);

  if (inboxUids.length > 0 && inboxFolder) {
    console.log(
      `[reject] Moving ${inboxUids.length} message(s) to IMAP archive for sender ${senderId}`,
    );
    after(async () => {
      console.log("[reject] after() callback fired for sender", senderId);
      try {
        await moveToArchiveViaImap(
          userId,
          sender.emailConnectionId,
          inboxFolder.id,
          inboxUids,
        );
        console.log(
          `[reject] IMAP archive move complete for sender ${senderId}`,
        );
      } catch (err) {
        console.error("IMAP archive move (reject) failed:", err);
      }
    });
  } else {
    console.log(
      `[reject] No IMAP move needed for sender ${senderId} (${inboxUids.length} UIDs, inboxFolder=${!!inboxFolder})`,
    );
  }
}

/** Hide a sender from the screener for 24 hours (skippedUntil = now + 24h). */
export async function skipSenderForUser(userId: string, senderId: string) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  await db.sender.update({
    where: { id: senderId },
    data: { skippedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
}

/** Clear a sender's skip window so it reappears in the screener. */
export async function unskipSenderForUser(userId: string, senderId: string) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  await db.sender.update({
    where: { id: senderId },
    data: { skippedUntil: null },
  });
}

/**
 * Undo a screen-in or screen-out action: revert the sender to PENDING and move
 * their inbox-folder messages back into the screener. No-op if already PENDING.
 */
export async function undoScreenActionForUser(
  userId: string,
  senderId: string,
) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, status: true, emailConnectionId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  if (sender.status === "PENDING") {
    return; // Already pending, nothing to undo
  }

  const inboxFolder = await db.folder.findFirst({
    where: { emailConnectionId: sender.emailConnectionId, specialUse: "inbox" },
    select: { id: true },
  });

  const archivedElsewhere = await db.message.findMany({
    where: {
      senderId,
      isArchived: true,
      uid: { gt: 0 },
      ...(inboxFolder ? { NOT: { folderId: inboxFolder.id } } : {}),
    },
    select: { uid: true, folderId: true },
  });

  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: {
        status: "PENDING",
        category: null,
        decidedAt: null,
      },
    }),
    db.message.updateMany({
      where: { senderId },
      data: {
        isArchived: false,
        isInScreener: true,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
      },
    }),
  ]);

  if (archivedElsewhere.length > 0) {
    const byFolder = new Map<string, number[]>();
    for (const row of archivedElsewhere) {
      const list = byFolder.get(row.folderId) ?? [];
      list.push(row.uid);
      byFolder.set(row.folderId, list);
    }
    after(() => {
      for (const [folderId, uids] of byFolder) {
        moveToInboxViaImap(
          userId,
          sender.emailConnectionId,
          folderId,
          uids,
        ).catch((err) =>
          console.error("IMAP undo-reject move failed:", err),
        );
      }
    });
  }
}

/**
 * Move an already-APPROVED sender to a different category, moving their
 * non-archived messages accordingly. Throws if the sender is not APPROVED.
 */
export async function changeSenderCategoryForUser(
  userId: string,
  senderId: string,
  category: SenderCategory,
) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, status: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  if (sender.status !== "APPROVED") {
    throw new Error("Sender must be approved first");
  }

  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: { category },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);
}

/** Toggle whether a sender's messages are grouped into threads. */
export async function setSenderUnthreadForUser(
  userId: string,
  senderId: string,
  unthread: boolean,
) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  await db.sender.update({
    where: { id: senderId },
    data: { unthread },
  });
}

/**
 * Set a sender's per-sender remote-image allowlist. When `allow` is true,
 * remote images from this sender always load regardless of the global block
 * default. Mirrors the web `setSenderImagePolicy` action, but takes `userId`
 * directly so the mobile route can call it without a session.
 */
export async function setSenderAllowImagesForUser(
  userId: string,
  senderId: string,
  allow: boolean,
) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });

  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }

  await db.sender.update({
    where: { id: senderId },
    data: { allowRemoteImages: allow },
  });
}

// ============================================
// DOMAIN SCREENING RULES (plan 033)
// ============================================

export interface CreateDomainRuleInput {
  /** Sender whose domain the rule was created from (scopes the connection). */
  senderId: string;
  pattern: string;
  includeSubdomains: boolean;
  status: SenderStatus; // APPROVED or REJECTED, never PENDING
  category?: SenderCategory | null;
}

/**
 * Create (or re-point) a domain rule and retroactively sweep all matching
 * PENDING senders on the connection through the existing approve/reject
 * cores. The origin sender always follows the rule (plan 034); other
 * already-decided senders are never touched. Upsert on
 * (emailConnectionId, pattern, includeSubdomains) makes replay idempotent.
 */
export async function createDomainRuleForUser(
  userId: string,
  input: CreateDomainRuleInput,
) {
  const pattern = input.pattern.trim().toLowerCase();
  if (input.status !== "APPROVED" && input.status !== "REJECTED") {
    throw new Error("Rule status must be APPROVED or REJECTED");
  }
  if (input.status === "APPROVED" && !input.category) {
    throw new Error("Category required for approve rules");
  }
  if (input.includeSubdomains && pattern.split(".").length < 2) {
    throw new Error("Invalid wildcard pattern");
  }

  const sender = await db.sender.findUnique({
    where: { id: input.senderId },
    select: {
      userId: true,
      domain: true,
      emailConnectionId: true,
      status: true,
      category: true,
    },
  });
  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }
  if (
    !patternMatchesDomain(sender.domain, {
      pattern,
      includeSubdomains: input.includeSubdomains,
    })
  ) {
    throw new Error("Pattern does not match sender domain");
  }

  const category = input.status === "APPROVED" ? input.category! : null;
  const rule = await db.domainRule.upsert({
    where: {
      emailConnectionId_pattern_includeSubdomains: {
        emailConnectionId: sender.emailConnectionId,
        pattern,
        includeSubdomains: input.includeSubdomains,
      },
    },
    create: {
      userId,
      emailConnectionId: sender.emailConnectionId,
      pattern,
      includeSubdomains: input.includeSubdomains,
      status: input.status,
      category,
    },
    update: { status: input.status, category },
  });

  // Retroactive sweep: decide matching PENDING senders via the existing cores
  // (moves mail, sets flags). APPROVED/REJECTED senders are never touched.
  const pending = await db.sender.findMany({
    where: { emailConnectionId: sender.emailConnectionId, status: "PENDING" },
    select: { id: true, domain: true },
  });
  const matching = pending.filter((s) => patternMatchesDomain(s.domain, rule));
  for (const s of matching) {
    if (rule.status === "APPROVED") {
      await approveSenderForUser(userId, s.id, rule.category!);
    } else {
      await rejectSenderForUser(userId, s.id);
    }
  }
  if (matching.length > 0) {
    await db.sender.updateMany({
      where: { id: { in: matching.map((s) => s.id) } },
      data: { decidedByRuleId: rule.id },
    });
  }

  // Plan 034: the origin sender follows the rule even when already decided,
  // so "Screen domain" works retroactively from an existing message. Other
  // decided senders on the domain are still never touched.
  if (sender.status !== "PENDING") {
    const needsMove =
      sender.status !== rule.status ||
      (rule.status === "APPROVED" && sender.category !== rule.category);
    if (needsMove) {
      if (rule.status === "APPROVED") {
        await approveSenderForUser(userId, input.senderId, rule.category!);
      } else {
        await rejectSenderForUser(userId, input.senderId);
      }
    }
    await db.sender.update({
      where: { id: input.senderId },
      data: { decidedByRuleId: rule.id },
    });
  }

  return rule;
}

/**
 * Point a domain rule at a (new) category and move every sender it decided
 * (decidedByRuleId) along with it, mirroring the per-sender category move.
 * Also flips a REJECTED rule to APPROVED. Manually decided senders are never
 * affected.
 */
export async function changeDomainRuleCategoryForUser(
  userId: string,
  ruleId: string,
  category: SenderCategory,
) {
  const rule = await db.domainRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule || rule.userId !== userId) {
    throw new Error("Rule not found");
  }

  await db.$transaction([
    db.domainRule.update({
      where: { id: ruleId },
      data: { status: "APPROVED", category },
    }),
    db.sender.updateMany({
      where: { decidedByRuleId: ruleId },
      data: { status: "APPROVED", category },
    }),
    db.message.updateMany({
      where: { sender: { decidedByRuleId: ruleId }, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);
}

/**
 * Delete a domain rule. Sender decisions are materialized, so their
 * status/category are kept — only the provenance link is cleared. New
 * senders from the domain land in the screener again. No-op when the rule
 * is already gone (idempotent replay).
 */
export async function deleteDomainRuleForUser(userId: string, ruleId: string) {
  const rule = await db.domainRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule) return;
  if (rule.userId !== userId) {
    throw new Error("Rule not found");
  }

  await db.$transaction([
    db.sender.updateMany({
      where: { decidedByRuleId: ruleId },
      data: { decidedByRuleId: null },
    }),
    db.domainRule.delete({ where: { id: ruleId } }),
  ]);
}

/** All domain rules for a user, for the screened list. */
export async function listDomainRulesForUser(userId: string) {
  return db.domainRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      pattern: true,
      includeSubdomains: true,
      status: true,
      category: true,
      emailConnectionId: true,
      createdAt: true,
    },
  });
}

// ============================================
// SUBJECT SCREENING RULES (kurir-ios#48)
// ============================================

export interface CreateSubjectRuleInput {
  /** Sender the rule was created from (scopes the connection). */
  senderId: string;
  scope: SubjectRuleScope;
  scopeValue: string;
  pattern: string;
  status: SenderStatus; // APPROVED or REJECTED, never PENDING
  category?: SenderCategory | null;
}

/**
 * Create (or re-point) a subject rule. Unlike sender/domain screening the
 * rule is evaluated per message at ingest, so it never touches the sender's
 * own decision. Upsert on (emailConnectionId, scope, scopeValue, pattern)
 * makes replay idempotent.
 */
export async function createSubjectRuleForUser(
  userId: string,
  input: CreateSubjectRuleInput,
) {
  const scopeValue = input.scopeValue.trim().toLowerCase();
  const pattern = input.pattern.trim().toLowerCase();
  if (input.status !== "APPROVED" && input.status !== "REJECTED") {
    throw new Error("Rule status must be APPROVED or REJECTED");
  }
  if (input.status === "APPROVED" && !input.category) {
    throw new Error("Category required for approve rules");
  }
  if (!pattern) {
    throw new Error("Subject pattern must not be empty");
  }
  if (input.scope === "SUBDOMAINS" && scopeValue.split(".").length < 2) {
    throw new Error("Invalid wildcard scope");
  }

  const sender = await db.sender.findUnique({
    where: { id: input.senderId },
    select: { userId: true, email: true, emailConnectionId: true },
  });
  if (!sender || sender.userId !== userId) {
    throw new Error("Sender not found");
  }
  if (
    !scopeMatchesSender(sender.email, {
      scope: input.scope,
      scopeValue,
      pattern,
    })
  ) {
    throw new Error("Scope does not match sender");
  }

  const category = input.status === "APPROVED" ? input.category! : null;
  const rule = await db.subjectRule.upsert({
    where: {
      emailConnectionId_scope_scopeValue_pattern: {
        emailConnectionId: sender.emailConnectionId,
        scope: input.scope,
        scopeValue,
        pattern,
      },
    },
    create: {
      userId,
      emailConnectionId: sender.emailConnectionId,
      scope: input.scope,
      scopeValue,
      pattern,
      status: input.status,
      category,
    },
    update: { status: input.status, category },
  });

  return rule;
}

/**
 * Point a subject rule at a (new) category and move every non-archived
 * message it filed (subjectRuleId provenance) along with it. Also flips a
 * REJECTED rule to APPROVED; already-archived matches stay archived
 * (decisions kept, mirroring domain rules).
 */
export async function changeSubjectRuleCategoryForUser(
  userId: string,
  ruleId: string,
  category: SenderCategory,
) {
  const rule = await db.subjectRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule || rule.userId !== userId) {
    throw new Error("Rule not found");
  }

  await db.$transaction([
    db.subjectRule.update({
      where: { id: ruleId },
      data: { status: "APPROVED", category },
    }),
    db.message.updateMany({
      where: { subjectRuleId: ruleId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: category === "IMBOX",
        isInFeed: category === "FEED",
        isInPaperTrail: category === "PAPER_TRAIL",
      },
    }),
  ]);
}

/**
 * Delete a subject rule. Message placements are materialized, so they are
 * kept — only the provenance link is cleared. New matching mail follows the
 * sender again. No-op when the rule is already gone (idempotent replay).
 */
export async function deleteSubjectRuleForUser(userId: string, ruleId: string) {
  const rule = await db.subjectRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule) return;
  if (rule.userId !== userId) {
    throw new Error("Rule not found");
  }

  await db.$transaction([
    db.message.updateMany({
      where: { subjectRuleId: ruleId },
      data: { subjectRuleId: null },
    }),
    db.subjectRule.delete({ where: { id: ruleId } }),
  ]);
}

/** All subject rules for a user, for the screened list. */
export async function listSubjectRulesForUser(userId: string) {
  return db.subjectRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scope: true,
      scopeValue: true,
      pattern: true,
      status: true,
      category: true,
      emailConnectionId: true,
      createdAt: true,
    },
  });
}

/**
 * Auto-approve all PENDING senders whose most recent message is older than
 * `days` days (into IMBOX). Returns the number of senders approved.
 */
export async function bulkApproveOldSendersForUser(
  userId: string,
  days: number = 90,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const oldSenders = await db.sender.findMany({
    where: {
      userId,
      status: "PENDING",
      messages: {
        some: {},
        none: { receivedAt: { gte: cutoff } },
      },
    },
    select: { id: true },
  });

  if (oldSenders.length === 0) return 0;

  const senderIds = oldSenders.map((s) => s.id);

  await db.$transaction([
    db.sender.updateMany({
      where: { id: { in: senderIds } },
      data: {
        status: "APPROVED",
        category: "IMBOX",
        decidedAt: new Date(),
      },
    }),
    db.message.updateMany({
      where: { senderId: { in: senderIds }, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: true,
      },
    }),
  ]);

  return oldSenders.length;
}
