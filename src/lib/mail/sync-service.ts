import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getConnectionCredentialsInternal } from "@/lib/auth";
import { isDemoInstance } from "@/lib/demo";
import { suppressEcho } from "@/lib/mail/flag-push";
import { findArchiveMailbox } from "@/lib/mail/imap-client";
import { buildImapAuth } from "@/lib/mail/auth-helpers";
import { deleteMessagesWithTombstones } from "@/lib/mail/tombstones";
import { type ImboxPushMessage } from "@/lib/mail/push-select";
import { type OwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";
import {
  asBodyBytes,
  storedContentToBuffer,
} from "@/lib/mail/attachment-bytes";
import { matchDomainRule } from "@/lib/mail/domain-rules";
import type { SenderCategory, SenderStatus } from "@prisma/client";

/** Domain screening rule shape needed at sync time (plan 033). */
export interface SyncDomainRule {
  id: string;
  pattern: string;
  includeSubdomains: boolean;
  status: SenderStatus;
  category: SenderCategory | null;
}

/**
 * Walk the IMAP bodyStructure tree to extract attachment part IDs.
 * These MIME part IDs (e.g. "1.2", "2") are what ImapFlow.download() expects.
 */
export function extractAttachmentParts(
  node: any,
  path: string = "",
): Array<{ partId: string; type: string; filename: string; size: number }> {
  if (node.childNodes) {
    return node.childNodes.flatMap((child: any, i: number) => {
      const childPath = path ? `${path}.${i + 1}` : String(i + 1);
      return extractAttachmentParts(child, childPath);
    });
  }
  const disposition = node.disposition?.toLowerCase?.() ?? "";
  const filename =
    node.dispositionParameters?.filename || node.parameters?.name || "";
  const type = node.subtype
    ? `${node.type}/${node.subtype}`.toLowerCase()
    : (node.type || "").toLowerCase();
  // Include all non-text parts: attachments, inline images, etc.
  // This must match what simpleParser puts in parsed.attachments
  if (
    disposition === "attachment" ||
    filename ||
    (disposition === "inline" && !type.startsWith("text/"))
  ) {
    return [
      {
        partId: path || "1",
        type,
        filename,
        size: node.size || 0,
      },
    ];
  }
  return [];
}

export interface SyncResult {
  folderId: string;
  folderPath: string;
  newMessages: number;
  errors: string[];
  remaining: number;
  totalOnServer: number;
  totalCached: number;
  /** New messages that landed in the Imbox — the push-notification set. */
  newImboxMessages: ImboxPushMessage[];
}

/**
 * UIDs worth fetching: above the folder's examined-UID watermark and not
 * already cached. The watermark is what stops messages that were examined
 * and dedup-skipped (Archive/All Mail copies of already-known messages)
 * from being re-fetched as "new" on every sync cycle.
 */
export function selectSyncCandidates(
  allUids: number[],
  existingUids: Set<number>,
  lastExaminedUid: number,
): number[] {
  return allUids.filter(
    (uid) => uid > lastExaminedUid && !existingUids.has(uid),
  );
}

/**
 * New watermark after a sync pass. Only a complete, error-free pass may
 * advance it (IMAP UIDs are strictly ascending while UIDVALIDITY holds), so
 * backfill remainders and failed messages stay eligible for the next pass.
 */
export function advanceWatermark(args: {
  current: number;
  allUids: number[];
  remaining: number;
  errorCount: number;
}): number {
  const { current, allUids, remaining, errorCount } = args;
  if (remaining > 0 || errorCount > 0 || allUids.length === 0) {
    return current;
  }
  return Math.max(current, allUids.reduce((a, b) => Math.max(a, b), 0));
}

/**
 * Extract domain from email address
 */
export function extractDomain(email: string): string {
  return email.split("@")[1] || email;
}

/**
 * Create a preview snippet from email body
 */
export function createSnippet(
  text: string | undefined,
  maxLength = 150,
): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^[\s>]+/gm, "")
    .trim();
  return cleaned.length > maxLength
    ? cleaned.substring(0, maxLength) + "..."
    : cleaned;
}

/**
 * Get or create a sender record scoped to an email connection.
 * If userEmail is provided and matches, auto-approve as IMBOX. Otherwise a
 * matching domain rule decides the sender directly (own address wins over
 * rules); with neither, the sender lands in the screener as PENDING.
 */
async function getOrCreateSender(
  userId: string,
  emailConnectionId: string,
  email: string,
  displayName: string | null,
  own?: OwnAddresses,
  domainRules?: SyncDomainRule[],
) {
  const domain = extractDomain(email);
  const isOwnEmail = !!own && isOwnAddress(email, own);
  const rule =
    !isOwnEmail && domainRules?.length
      ? matchDomainRule(domain, domainRules)
      : null;

  const sender = await db.sender.upsert({
    where: {
      emailConnectionId_email: { emailConnectionId, email },
    },
    create: {
      userId,
      emailConnectionId,
      email,
      displayName,
      domain,
      status: isOwnEmail ? "APPROVED" : rule ? rule.status : "PENDING",
      category: rule?.category ?? "IMBOX",
      messageCount: 1,
      ...(isOwnEmail || rule ? { decidedAt: new Date() } : {}),
      ...(rule ? { decidedByRuleId: rule.id } : {}),
    },
    update: {
      displayName: displayName || undefined,
    },
  });

  // Retroactive fix: upgrade own email from PENDING to APPROVED
  if (isOwnEmail && sender.status === "PENDING") {
    const updated = await db.sender.update({
      where: { id: sender.id },
      data: { status: "APPROVED", category: "IMBOX", decidedAt: new Date() },
    });

    // Reclassify existing messages (mirrors approveSender() pattern)
    await db.message.updateMany({
      where: { senderId: sender.id, isInScreener: true },
      data: { isInScreener: false, isInImbox: true },
    });

    console.log(`[sync] Auto-approved own email sender: ${email}`);
    return updated;
  }

  return sender;
}

/**
 * Map IMAP special use flags to DB values
 */
function mapSpecialUse(
  mailboxPath: string,
  imapSpecialUse?: string,
): string | null {
  if (mailboxPath.toLowerCase() === "inbox") return "inbox";
  if (!imapSpecialUse) return null;
  const mapping: Record<string, string> = {
    "\\Sent": "sent",
    "\\Drafts": "drafts",
    "\\Trash": "trash",
    "\\Junk": "junk",
    "\\Archive": "archive",
    "\\All": "all",
  };
  return mapping[imapSpecialUse] || null;
}

/**
 * Sync a single mailbox/folder for a given email connection
 */
async function syncMailbox(
  client: ImapFlow,
  userId: string,
  emailConnectionId: string,
  mailboxPath: string,
  imapSpecialUse?: string,
  batchSize?: number,
  own?: OwnAddresses,
  domainRules?: SyncDomainRule[],
): Promise<SyncResult> {
  const errors: string[] = [];
  let newMessages = 0;
  const newImboxMessages: ImboxPushMessage[] = [];

  // Get or create folder record scoped to the email connection
  let folder = await db.folder.findUnique({
    where: { emailConnectionId_path: { emailConnectionId, path: mailboxPath } },
  });

  // Open the mailbox
  const mailbox = await client.getMailboxLock(mailboxPath);

  try {
    const status = await client.status(mailboxPath, {
      messages: true,
      uidNext: true,
      uidValidity: true,
      highestModseq: true,
    });

    // Convert bigint to number for database storage
    const uidValidity = status.uidValidity ? Number(status.uidValidity) : null;

    const specialUse = mapSpecialUse(mailboxPath, imapSpecialUse);

    // Create folder if it doesn't exist
    if (!folder) {
      folder = await db.folder.create({
        data: {
          userId,
          emailConnectionId,
          name: mailboxPath.split("/").pop() || mailboxPath,
          path: mailboxPath,
          uidValidity,
          specialUse,
        },
      });
    } else if (specialUse && !folder.specialUse) {
      // Update existing folder if specialUse was missing
      folder = await db.folder.update({
        where: { id: folder.id },
        data: { specialUse },
      });
    }

    // Check if UIDVALIDITY changed (need full resync)
    if (
      folder.uidValidity &&
      uidValidity &&
      folder.uidValidity !== uidValidity
    ) {
      // Delete all cached messages for this folder
      await deleteMessagesWithTombstones({ folderId: folder.id });
      // Update UIDVALIDITY; UIDs start over, so the watermark must too
      folder = await db.folder.update({
        where: { id: folder.id },
        data: { uidValidity, lastExaminedUid: 0 },
      });
    }

    // Get existing UIDs in our cache
    const existingMessages = await db.message.findMany({
      where: { folderId: folder.id },
      select: { uid: true },
    });
    const existingUids = new Set(existingMessages.map((m) => m.uid));

    // Fetch all UIDs from server
    const searchResult = await client.search({ all: true }, { uid: true });

    // Handle case where search returns false (no messages)
    const allUids: number[] =
      searchResult === false ? [] : (searchResult as any[]).map(Number);

    // Find new UIDs (above the examined watermark and not cached)
    const newUids = selectSyncCandidates(
      allUids,
      existingUids,
      folder.lastExaminedUid,
    );

    // Clean up messages deleted on the IMAP server.
    // Skip archived messages — they were intentionally moved by Kurir.
    const serverUidSet = new Set(allUids);
    const deletedUids = [...existingUids].filter(
      (uid) => uid > 0 && !serverUidSet.has(uid),
    );
    if (deletedUids.length > 0) {
      const count = await deleteMessagesWithTombstones({
        folderId: folder.id,
        uid: { in: deletedUids },
        isArchived: false,
      });
      if (count > 0) {
        console.log(
          `[sync] ${mailboxPath}: removed ${count} messages deleted on server`,
        );
      }
    }

    console.log(
      `[sync] ${mailboxPath}: ${allUids.length} on server, ${existingUids.size} cached, ${newUids.length} new`,
    );

    if (newUids.length === 0) {
      return {
        folderId: folder.id,
        folderPath: mailboxPath,
        newMessages: 0,
        errors,
        remaining: 0,
        totalOnServer: allUids.length,
        totalCached: existingUids.size - deletedUids.length,
        newImboxMessages,
      };
    }

    // Process newest first — keeps the minUid:* IMAP range tight
    newUids.sort((a, b) => b - a);
    const batch = batchSize ? newUids.slice(0, batchSize) : newUids;
    const remaining = newUids.length - batch.length;

    // Group batch UIDs into tight contiguous ranges (gap ≤ 10)
    // Range fetch works but individual UID fetch hangs in ImapFlow
    const sortedBatch = [...batch].sort((a, b) => a - b);
    const ranges: { start: number; end: number }[] = [];
    let rangeStart = sortedBatch[0];
    let rangeEnd = sortedBatch[0];

    for (let i = 1; i < sortedBatch.length; i++) {
      if (sortedBatch[i] - rangeEnd <= 10) {
        rangeEnd = sortedBatch[i];
      } else {
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = sortedBatch[i];
        rangeEnd = sortedBatch[i];
      }
    }
    ranges.push({ start: rangeStart, end: rangeEnd });

    const batchSet = new Set(batch);

    const fetchOpts = {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
      bodyStructure: true,
      source: true,
    } as const;

    console.log(
      `[sync] ${mailboxPath}: fetching ${batch.length} UIDs in ${ranges.length} ranges`,
    );

    try {
      for (const range of ranges) {
        const fetchRange = `${range.start}:${range.end}`;
        const batchInRange = sortedBatch.filter(
          (u) => u >= range.start && u <= range.end,
        );
        console.log(
          `[sync] ${mailboxPath}: fetching range ${fetchRange} (${batchInRange.length} targets, sample: ${batchInRange.slice(0, 3).join(",")})`,
        );
        try {
          let rangeTotal = 0;
          let rangeMatched = 0;
          const sampleFetchUids: number[] = [];
          for await (const msg of client.fetch(fetchRange, fetchOpts, {
            uid: true,
          })) {
            rangeTotal++;
            const msgUid = Number(msg.uid);
            if (sampleFetchUids.length < 3) sampleFetchUids.push(msgUid);
            if (!batchSet.has(msgUid)) continue;
            rangeMatched++;

            try {
              // For All Mail / Archive: skip messages already synced from another folder
              if (
                (specialUse === "all" || specialUse === "archive") &&
                msg.envelope?.messageId
              ) {
                const existing = await db.message.findFirst({
                  where: { userId, messageId: msg.envelope.messageId },
                  select: { id: true },
                });
                if (existing) continue;
              }

              let isInbox = specialUse === "inbox";
              let archived = false;
              if (specialUse === "all" && own) {
                const fromAddr =
                  msg.envelope?.from?.[0]?.address?.toLowerCase();
                const isFromSelf = !!fromAddr && isOwnAddress(fromAddr, own);
                isInbox = false;
                archived = !isFromSelf;
              } else if (specialUse === "archive") {
                isInbox = false;
                archived = true;
              }

              const saved = await processMessage(
                msg,
                userId,
                emailConnectionId,
                folder.id,
                {
                  isInbox,
                  own,
                  isArchived: archived,
                  domainRules,
                },
              );
              newMessages++;
              if (saved?.isInImbox) {
                newImboxMessages.push({
                  id: saved.id,
                  fromName: saved.fromName,
                  fromAddress: saved.fromAddress,
                  subject: saved.subject,
                  threadId: saved.threadId,
                });
              }
            } catch (err) {
              errors.push(`Failed to process message ${msgUid}: ${err}`);
            }
          }
          console.log(
            `[sync] ${mailboxPath}: range ${fetchRange} done: ${rangeTotal} fetched (sample UIDs: ${sampleFetchUids.join(",")}), ${rangeMatched} matched, ${newMessages} saved`,
          );
        } catch (fetchErr) {
          console.error(
            `[sync] ${mailboxPath}: range ${fetchRange} error:`,
            fetchErr,
          );
          errors.push(`Fetch error for range ${fetchRange}: ${fetchErr}`);
        }
      }
    } catch (outerErr) {
      console.error(`[sync] ${mailboxPath}: fetch error:`, outerErr);
      errors.push(`Fetch error: ${outerErr}`);
    }

    // Update folder sync time + highestModSeq + examined-UID watermark
    await db.folder.update({
      where: { id: folder.id },
      data: {
        lastSyncedAt: new Date(),
        highestModSeq: status.highestModseq
          ? BigInt(status.highestModseq)
          : undefined,
        lastExaminedUid: advanceWatermark({
          current: folder.lastExaminedUid,
          allUids,
          remaining,
          errorCount: errors.length,
        }),
      },
    });

    return {
      folderId: folder.id,
      folderPath: mailboxPath,
      newMessages,
      errors,
      remaining,
      totalOnServer: allUids.length,
      totalCached: existingUids.size + newMessages,
      newImboxMessages,
    };
  } finally {
    mailbox.release();
  }
}

interface ProcessMessageOptions {
  isInbox: boolean;
  own?: OwnAddresses;
  isArchived?: boolean;
  domainRules?: SyncDomainRule[];
}

/**
 * Process and store a single message, scoped to an email connection
 */
export async function processMessage(
  msg: FetchMessageObject,
  userId: string,
  emailConnectionId: string,
  folderId: string,
  options: ProcessMessageOptions,
) {
  const { isInbox, own, isArchived = false, domainRules } = options;
  const envelope = msg.envelope;
  const flags = msg.flags;

  if (!envelope) {
    throw new Error("Message has no envelope");
  }

  if (!msg.source) {
    throw new Error("Message has no source");
  }

  // Parse the full message for body content
  const parsed = await simpleParser(msg.source);

  // Extract sender info
  const fromHeader = envelope.from?.[0];
  const fromAddress =
    fromHeader?.address?.toLowerCase() || "unknown@unknown.com";
  const fromName = fromHeader?.name || null;

  // Get or create sender scoped to the email connection
  const sender = await getOrCreateSender(
    userId,
    emailConnectionId,
    fromAddress,
    fromName,
    own,
    domainRules,
  );

  // Only categorize inbox messages; sent/other folders skip categorization
  const isInScreener = isInbox && !isArchived && sender.status === "PENDING";
  const isRejectedInbox =
    isInbox && !isArchived && sender.status === "REJECTED";

  // Auto-archive messages from rejected senders
  const finalIsArchived = isArchived || isRejectedInbox;

  // Category flags must be false for archived messages
  const isInImbox =
    isInbox &&
    !finalIsArchived &&
    sender.status === "APPROVED" &&
    sender.category === "IMBOX";
  const isInFeed =
    isInbox &&
    !finalIsArchived &&
    sender.status === "APPROVED" &&
    sender.category === "FEED";
  const isInPaperTrail =
    isInbox &&
    !finalIsArchived &&
    sender.status === "APPROVED" &&
    sender.category === "PAPER_TRAIL";

  // Check for attachments
  const hasAttachments = parsed.attachments && parsed.attachments.length > 0;

  // Compute threadId by looking up existing messages in the same conversation
  const references = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];
  const inReplyTo = envelope.inReplyTo || null;

  let threadId: string | null = null;

  const relatedIds = [...references];
  if (inReplyTo && !relatedIds.includes(inReplyTo)) {
    relatedIds.push(inReplyTo);
  }

  if (relatedIds.length > 0) {
    const existingThreadMsg = await db.message.findFirst({
      where: {
        userId,
        OR: [
          { messageId: { in: relatedIds } },
          { threadId: { in: relatedIds } },
        ],
        threadId: { not: null },
      },
      select: { threadId: true },
    });

    if (existingThreadMsg?.threadId) {
      threadId = existingThreadMsg.threadId;
    } else {
      threadId = references[0] || inReplyTo;
    }
  }

  if (!threadId) {
    threadId = envelope.messageId || null;
  }

  // Unify threadId across all related messages in the conversation
  if (threadId && relatedIds.length > 0) {
    await db.message.updateMany({
      where: {
        userId,
        OR: [
          { messageId: { in: relatedIds } },
          { inReplyTo: { in: relatedIds } },
        ],
        NOT: { threadId },
      },
      data: { threadId },
    });
  }

  // Check for locally-created duplicate (negative UID from sent replies)
  if (envelope.messageId) {
    const localDuplicate = await db.message.findFirst({
      where: {
        userId,
        messageId: envelope.messageId,
        uid: { lt: 0 },
      },
    });
    if (localDuplicate) {
      const updated = await db.message.update({
        where: { id: localDuplicate.id },
        data: { uid: msg.uid, folderId },
      });
      return updated;
    }
  }

  // Fallback dedup by content for negative-UID records
  if (envelope.date) {
    const snippet = createSnippet(parsed.text);
    const localByContent = await db.message.findFirst({
      where: {
        userId,
        uid: { lt: 0 },
        fromAddress,
        subject: envelope.subject || null,
        ...(snippet ? { snippet } : {}),
        sentAt: {
          gte: new Date(envelope.date.getTime() - 60000),
          lte: new Date(envelope.date.getTime() + 60000),
        },
      },
      orderBy: { sentAt: "desc" },
    });
    if (localByContent) {
      const oldMessageId = localByContent.messageId;
      const newMessageId = envelope.messageId || undefined;
      const updated = await db.message.update({
        where: { id: localByContent.id },
        data: { uid: msg.uid, folderId, messageId: newMessageId },
      });
      if (oldMessageId && newMessageId && oldMessageId !== newMessageId) {
        await db.message.updateMany({
          where: { userId, inReplyTo: oldMessageId },
          data: { inReplyTo: newMessageId },
        });
      }
      return updated;
    }
  }

  // Create message record
  const message = await db.message.create({
    data: {
      uid: msg.uid,
      messageId: envelope.messageId || null,
      threadId,
      inReplyTo,
      references,
      subject: envelope.subject || null,
      fromAddress,
      fromName,
      toAddresses:
        envelope.to?.map((a) => a.address || "").filter(Boolean) || [],
      ccAddresses:
        envelope.cc?.map((a) => a.address || "").filter(Boolean) || [],
      sentAt: envelope.date || null,
      receivedAt: msg.internalDate || envelope.date || new Date(),
      textBody: parsed.text || null,
      htmlBody: parsed.html || null,
      snippet: createSnippet(parsed.text),
      isRead: flags?.has("\\Seen") ?? false,
      isFlagged: flags?.has("\\Flagged") ?? false,
      isDraft: flags?.has("\\Draft") ?? false,
      isDeleted: flags?.has("\\Deleted") ?? false,
      isAnswered: flags?.has("\\Answered") ?? false,
      size: msg.size || null,
      hasAttachments,
      isInScreener,
      isInImbox,
      isInFeed,
      isInPaperTrail,
      isArchived: finalIsArchived,
      folderId,
      userId,
      emailConnectionId,
      senderId: sender.id,
    },
  });

  // Store attachments metadata with correct MIME part IDs from bodyStructure
  if (parsed.attachments && parsed.attachments.length > 0) {
    const structureParts = msg.bodyStructure
      ? extractAttachmentParts(msg.bodyStructure)
      : [];

    const attachmentData = parsed.attachments.map((att, index) => {
      const matched =
        structureParts.find(
          (sp) =>
            sp.type ===
              (att.contentType || "application/octet-stream").toLowerCase() &&
            sp.filename === (att.filename || ""),
        ) ?? structureParts[index];
      const bytes = storedContentToBuffer(att.content);
      const size = att.size || bytes?.length || matched?.size || 0;
      return {
        messageId: message.id,
        filename: att.filename || `attachment-${index}`,
        contentType: att.contentType || "application/octet-stream",
        size,
        contentId: att.cid || null,
        partId: matched?.partId ?? String(index + 1),
        encoding:
          (att as unknown as { contentTransferEncoding?: string })
            .contentTransferEncoding || null,
        // Skip empty bodies and attachments > 10MB (lazy-download on demand).
        // An empty Buffer is truthy — storing it made download/send serve 0 bytes.
        content:
          bytes && size <= 10 * 1024 * 1024 ? asBodyBytes(bytes) : null,
      };
    });

    await db.attachment.createMany({
      data: attachmentData,
    });
  }

  await db.sender.update({
    where: { id: sender.id },
    data: { messageCount: { increment: 1 } },
  });

  // Auto-cancel/clear follow-up reminders when an incoming reply arrives
  if (isInbox && threadId && own && !isOwnAddress(fromAddress, own)) {
    await db.message.updateMany({
      where: {
        userId,
        threadId,
        OR: [{ followUpAt: { not: null } }, { isFollowUp: true }],
      },
      data: {
        followUpAt: null,
        followUpSetAt: null,
        isFollowUp: false,
      },
    });
  }

  return message;
}

/**
 * Walk inReplyTo chains to unify threadIds across entire conversations.
 */
async function repairThreadIds(userId: string) {
  const messages = await db.message.findMany({
    where: { userId },
    select: { id: true, messageId: true, threadId: true, inReplyTo: true },
  });

  const byMessageId = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (m.messageId) byMessageId.set(m.messageId, m);
  }

  function findRootMessageId(msg: (typeof messages)[number]): string | null {
    const visited = new Set<string>();
    let current = msg;
    while (current.inReplyTo && byMessageId.has(current.inReplyTo)) {
      if (visited.has(current.inReplyTo)) break;
      visited.add(current.inReplyTo);
      current = byMessageId.get(current.inReplyTo)!;
    }
    return current.messageId;
  }

  const fixes: { id: string; threadId: string }[] = [];
  for (const msg of messages) {
    const rootMessageId = findRootMessageId(msg);
    if (rootMessageId && msg.threadId !== rootMessageId) {
      fixes.push({ id: msg.id, threadId: rootMessageId });
    }
  }

  if (fixes.length > 0) {
    const byThreadId = new Map<string, string[]>();
    for (const { id, threadId } of fixes) {
      if (!byThreadId.has(threadId)) byThreadId.set(threadId, []);
      byThreadId.get(threadId)!.push(id);
    }
    for (const [threadId, ids] of byThreadId) {
      await db.message.updateMany({
        where: { id: { in: ids } },
        data: { threadId },
      });
    }
    console.log(`[sync] Repaired threadIds for ${fixes.length} messages`);
  }
}

/**
 * After sync, move any rejected-sender messages still sitting in the
 * IMAP inbox to the archive folder. Updates DB uid to -1 so the next
 * archive-folder sync reconciles them with correct UID + folderId.
 */
async function moveRejectedToArchive(
  client: ImapFlow,
  mailboxes: Awaited<ReturnType<ImapFlow["list"]>>,
  userId: string,
  inboxFolderId: string,
) {
  const stale = await db.message.findMany({
    where: {
      userId,
      folderId: inboxFolderId,
      isArchived: true,
      uid: { gt: 0 },
      sender: { status: "REJECTED" },
    },
    select: { id: true, uid: true },
  });

  if (stale.length === 0) return;

  console.log(
    `[sync] moveRejectedToArchive: ${stale.length} message(s) to move`,
  );

  const archiveBox = findArchiveMailbox(mailboxes);

  if (!archiveBox) {
    console.warn(
      `[sync] Cannot move ${stale.length} rejected-sender message(s): no archive folder`,
    );
    return;
  }

  console.log(
    `[sync] Moving ${stale.length} rejected-sender message(s) from INBOX → ${archiveBox.path}`,
  );

  const movedIds: string[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = stale.map((m) => m.uid);
    const BATCH = 100;
    for (let i = 0; i < uids.length; i += BATCH) {
      const chunk = uids.slice(i, i + BATCH);
      // Register echo suppression per-batch to keep TTL tight
      for (const uid of chunk) {
        suppressEcho(userId, inboxFolderId, uid);
      }
      try {
        await client.messageMove(chunk, archiveBox.path, { uid: true });
        movedIds.push(
          ...stale.filter((m) => chunk.includes(m.uid)).map((m) => m.id),
        );
      } catch (err) {
        console.error(`[sync] Failed to move UIDs ${chunk.join(",")}:`, err);
      }
    }
  } finally {
    lock.release();
  }

  // Delete only the rows whose IMAP move succeeded. A failed batch stays
  // local (still archived) so lastExaminedUid cannot hide mail that never
  // left INBOX.
  if (movedIds.length > 0) {
    await deleteMessagesWithTombstones({
      id: { in: movedIds },
      isArchived: true,
    });
  }
}

/**
 * Perform a full sync for a single email connection
 */
export async function syncEmailConnection(
  emailConnectionId: string,
  options?: { batchSize?: number },
): Promise<{
  success: boolean;
  results: SyncResult[];
  error?: string;
}> {
  // Demo instances have fictional IMAP hosts — sync is a successful no-op
  // so the seeded mail stays untouched and no error banner appears.
  if (isDemoInstance()) {
    return { success: true, results: [] };
  }

  const credentials = await getConnectionCredentialsInternal(emailConnectionId);

  if (!credentials) {
    return {
      success: false,
      results: [],
      error: "Connection credentials not found",
    };
  }

  // Look up userId for this connection
  const emailConn = await db.emailConnection.findUnique({
    where: { id: emailConnectionId },
    select: { userId: true },
  });
  if (!emailConn) {
    return { success: false, results: [], error: "Email connection not found" };
  }

  const userId = emailConn.userId;

  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: true,
    auth: buildImapAuth(credentials),
    logger: false,
  });

  const results: SyncResult[] = [];

  try {
    await client.connect();

    const mailboxes = await client.list();

    const toSync: { path: string; specialUse?: string }[] = [{ path: "INBOX" }];

    for (const mb of mailboxes) {
      if (
        mb.specialUse === "\\Sent" ||
        mb.path.toLowerCase().includes("sent")
      ) {
        toSync.push({ path: mb.path, specialUse: mb.specialUse });
        break;
      }
    }

    for (const mb of mailboxes) {
      if (mb.specialUse === "\\All") {
        toSync.push({ path: mb.path, specialUse: mb.specialUse });
        break;
      }
    }

    // Sync Archive folder (iCloud and others that don't have \All)
    for (const mb of mailboxes) {
      if (
        mb.specialUse === "\\Archive" ||
        mb.path.toLowerCase() === "archive"
      ) {
        toSync.push({
          path: mb.path,
          specialUse: mb.specialUse || "\\Archive",
        });
        break;
      }
    }

    // Collect all emails the user sends from (login email + sendAs alias)
    const userEmails = [credentials.email];
    if (
      credentials.sendAsEmail &&
      credentials.sendAsEmail.toLowerCase() !== credentials.email.toLowerCase()
    ) {
      userEmails.push(credentials.sendAsEmail);
    }
    if (credentials.aliases?.length) {
      userEmails.push(
        ...credentials.aliases.filter(
          (a) => !userEmails.some((ue) => ue.toLowerCase() === a.toLowerCase()),
        ),
      );
    }

    const own: OwnAddresses = {
      emails: userEmails.map((e) => e.trim().toLowerCase()),
      domains: credentials.treatDomainAsOwn
        ? [credentials.email.trim().toLowerCase().split("@")[1]].filter(Boolean)
        : [],
    };

    // Domain screening rules, loaded once per sync run (same pattern as
    // OwnAddresses) so every new sender in this run sees the same rule set.
    const domainRules = await db.domainRule.findMany({
      where: { emailConnectionId },
    });

    const { heartbeatSyncLock } = await import("@/lib/mail/sync-lock");

    for (const { path, specialUse } of toSync) {
      await heartbeatSyncLock(emailConnectionId);
      try {
        const result = await syncMailbox(
          client,
          userId,
          emailConnectionId,
          path,
          specialUse,
          options?.batchSize,
          own,
          domainRules,
        );
        console.log(
          `[sync] ${path}: ${result.newMessages} new, ${result.remaining} remaining, ${result.errors.length} errors`,
        );
        results.push(result);
      } catch (err) {
        console.error(`[sync] ${path}: error:`, err);
        results.push({
          folderId: "",
          folderPath: path,
          newMessages: 0,
          errors: [`Failed to sync ${path}: ${err}`],
          remaining: 0,
          totalOnServer: 0,
          totalCached: 0,
          newImboxMessages: [],
        });
      }
    }

    const hasRemaining = results.some((r) => r.remaining > 0);
    const processedMessages = results.reduce((sum, r) => sum + r.newMessages, 0);
    // Thread relationships only change when a message was processed (created or
    // reconciled) — a drained sync that touched nothing makes the repair a
    // guaranteed no-op, so skip the full-table load.
    if (!hasRemaining && processedMessages > 0) {
      await repairThreadIds(userId);
    }

    // Move rejected-sender messages out of IMAP inbox
    const inboxResult = results.find((r) => r.folderPath === "INBOX");
    if (inboxResult?.folderId) {
      await moveRejectedToArchive(
        client,
        mailboxes,
        userId,
        inboxResult.folderId,
      );
    }

    return { success: true, results };
  } catch (err) {
    return {
      success: false,
      results,
      error: `Connection failed: ${err}`,
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors
    }
  }
}
