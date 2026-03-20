import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getConnectionCredentialsInternal } from "@/lib/auth";
import { suppressEcho } from "@/lib/mail/flag-push";
import { findArchiveMailbox } from "@/lib/mail/imap-client";

/**
 * Walk the IMAP bodyStructure tree to extract attachment part IDs.
 * These MIME part IDs (e.g. "1.2", "2") are what ImapFlow.download() expects.
 */
function extractAttachmentParts(
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
}

/**
 * Extract domain from email address
 */
function extractDomain(email: string): string {
  return email.split("@")[1] || email;
}

/**
 * Create a preview snippet from email body
 */
function createSnippet(
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
 * If userEmail is provided and matches, auto-approve as IMBOX.
 */
async function getOrCreateSender(
  userId: string,
  emailConnectionId: string,
  email: string,
  displayName: string | null,
  userEmails?: string[],
) {
  const domain = extractDomain(email);
  const isOwnEmail =
    !!userEmails &&
    userEmails.some((ue) => email.toLowerCase() === ue.toLowerCase());

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
      status: isOwnEmail ? "APPROVED" : "PENDING",
      category: "IMBOX",
      messageCount: 1,
      ...(isOwnEmail ? { decidedAt: new Date() } : {}),
    },
    update: {
      displayName: displayName || undefined,
      messageCount: { increment: 1 },
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
  userEmails?: string[],
): Promise<SyncResult> {
  const errors: string[] = [];
  let newMessages = 0;

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
      await db.message.deleteMany({
        where: { folderId: folder.id },
      });
      // Update UIDVALIDITY
      await db.folder.update({
        where: { id: folder.id },
        data: { uidValidity },
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

    // Find new UIDs
    const newUids = allUids.filter((uid) => !existingUids.has(uid));

    // Clean up messages deleted on the IMAP server.
    // Skip archived messages — they were intentionally moved by Kurir.
    const serverUidSet = new Set(allUids);
    const deletedUids = [...existingUids].filter(
      (uid) => uid > 0 && !serverUidSet.has(uid),
    );
    if (deletedUids.length > 0) {
      const { count } = await db.message.deleteMany({
        where: {
          folderId: folder.id,
          uid: { in: deletedUids },
          isArchived: false,
        },
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
              if (specialUse === "all" && userEmails?.length) {
                const fromAddr =
                  msg.envelope?.from?.[0]?.address?.toLowerCase();
                const isFromSelf =
                  !!fromAddr &&
                  userEmails.some((ue) => fromAddr === ue.toLowerCase());
                isInbox = false;
                archived = !isFromSelf;
              } else if (specialUse === "archive") {
                isInbox = false;
                archived = true;
              }

              await processMessage(msg, userId, emailConnectionId, folder.id, {
                isInbox,
                userEmails,
                isArchived: archived,
              });
              newMessages++;
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

    // Update folder sync time + highestModSeq
    await db.folder.update({
      where: { id: folder.id },
      data: {
        lastSyncedAt: new Date(),
        highestModSeq: status.highestModseq
          ? BigInt(status.highestModseq)
          : undefined,
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
    };
  } finally {
    mailbox.release();
  }
}

interface ProcessMessageOptions {
  isInbox: boolean;
  userEmails?: string[];
  isArchived?: boolean;
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
  const { isInbox, userEmails, isArchived = false } = options;
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
    userEmails,
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

    const attachmentData = parsed.attachments.map((att, index) => ({
      messageId: message.id,
      filename: att.filename || `attachment-${index}`,
      contentType: att.contentType || "application/octet-stream",
      size: att.size || 0,
      contentId: att.cid || null,
      partId:
        structureParts.find(
          (sp) =>
            sp.type ===
              (att.contentType || "application/octet-stream").toLowerCase() &&
            sp.filename === (att.filename || ""),
        )?.partId ??
        structureParts[index]?.partId ??
        String(index + 1),
      encoding:
        (att as unknown as { contentTransferEncoding?: string })
          .contentTransferEncoding || null,
      content: att.content ? Buffer.from(att.content) : null,
    }));

    await db.attachment.createMany({
      data: attachmentData,
    });
  }

  // Auto-cancel/clear follow-up reminders when an incoming reply arrives
  if (isInbox && threadId && userEmails && !userEmails.includes(fromAddress)) {
    await db.message.updateMany({
      where: {
        userId,
        threadId,
        OR: [
          { followUpAt: { not: null } },
          { isFollowUp: true },
        ],
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
      } catch (err) {
        console.error(`[sync] Failed to move UIDs ${chunk.join(",")}:`, err);
      }
    }
  } finally {
    lock.release();
  }

  // Delete moved messages — the archive-folder sync will recreate them
  // with the correct folderId and UID via the messageId dedup path.
  // (Previously set uid=-1, but updateMany with a fixed uid violated
  // the @@unique([folderId, uid]) constraint when multiple messages moved.)
  await db.message.deleteMany({
    where: { id: { in: stale.map((m) => m.id) }, isArchived: true },
  });
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
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
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

    for (const { path, specialUse } of toSync) {
      try {
        const result = await syncMailbox(
          client,
          userId,
          emailConnectionId,
          path,
          specialUse,
          options?.batchSize,
          userEmails,
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
        });
      }
    }

    const hasRemaining = results.some((r) => r.remaining > 0);
    if (!hasRemaining) {
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
