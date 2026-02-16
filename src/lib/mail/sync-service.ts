import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getUserCredentials } from "@/lib/auth";

interface SyncResult {
  folderId: string;
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
function createSnippet(text: string | undefined, maxLength = 150): string | null {
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
 * Get or create a sender record
 */
async function getOrCreateSender(
  userId: string,
  email: string,
  displayName: string | null
) {
  const domain = extractDomain(email);

  const sender = await db.sender.upsert({
    where: {
      userId_email: { userId, email },
    },
    create: {
      userId,
      email,
      displayName,
      domain,
      status: "PENDING",
      category: "IMBOX",
      messageCount: 1,
    },
    update: {
      displayName: displayName || undefined,
      messageCount: { increment: 1 },
    },
  });

  return sender;
}

/**
 * Map IMAP special use flags to DB values
 */
function mapSpecialUse(
  mailboxPath: string,
  imapSpecialUse?: string
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
 * Sync a single mailbox/folder
 */
async function syncMailbox(
  client: ImapFlow,
  userId: string,
  mailboxPath: string,
  imapSpecialUse?: string,
  batchSize?: number,
  userEmail?: string
): Promise<SyncResult> {
  const errors: string[] = [];
  let newMessages = 0;

  // Get or create folder record
  let folder = await db.folder.findUnique({
    where: { userId_path: { userId, path: mailboxPath } },
  });

  // Open the mailbox
  const mailbox = await client.getMailboxLock(mailboxPath);

  try {
    const status = await client.status(mailboxPath, {
      messages: true,
      uidNext: true,
      uidValidity: true,
    });

    // Convert bigint to number for database storage
    const uidValidity = status.uidValidity ? Number(status.uidValidity) : null;

    const specialUse = mapSpecialUse(mailboxPath, imapSpecialUse);

    // Create folder if it doesn't exist
    if (!folder) {
      folder = await db.folder.create({
        data: {
          userId,
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
    if (folder.uidValidity && uidValidity && folder.uidValidity !== uidValidity) {
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
    const allUids: number[] = searchResult === false ? [] : (searchResult as any[]).map(Number);

    // Find new UIDs
    const newUids = allUids.filter((uid) => !existingUids.has(uid));

    console.log(`[sync] ${mailboxPath}: ${allUids.length} on server, ${existingUids.size} cached, ${newUids.length} new`);

    if (newUids.length === 0) {
      return { folderId: folder.id, newMessages: 0, errors, remaining: 0, totalOnServer: allUids.length, totalCached: existingUids.size };
    }

    // Batch: only process a subset of new UIDs if batchSize is set
    const batch = batchSize ? newUids.slice(0, batchSize) : newUids;
    const remaining = newUids.length - batch.length;

    // Build a fetch range: use min:max UID range to limit what we download
    const batchSet = new Set(batch);
    const minUid = Math.min(...batch);
    const fetchRange = `${minUid}:*`;

    try {
      for await (const msg of client.fetch(fetchRange, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        source: true,
      })) {
        const msgUid = Number(msg.uid);
        if (!batchSet.has(msgUid)) {
          continue;
        }
        try {
          // For All Mail: skip messages already synced from another folder
          if (specialUse === "all" && msg.envelope?.messageId) {
            const existing = await db.message.findFirst({
              where: { userId, messageId: msg.envelope.messageId },
              select: { id: true },
            });
            if (existing) continue;
          }

          // For All Mail: treat received messages as inbox (screener),
          // sent messages (from == user) skip categorization like Sent folder
          let isInbox = specialUse === "inbox";
          if (specialUse === "all" && userEmail) {
            const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
            isInbox = fromAddr !== userEmail.toLowerCase();
          }

          await processMessage(msg, userId, folder.id, isInbox);
          newMessages++;
        } catch (err) {
          errors.push(`Failed to process message ${msgUid}: ${err}`);
        }
      }
    } catch (fetchErr) {
      console.error(`[sync] ${mailboxPath}: fetch error:`, fetchErr);
      errors.push(`Fetch error: ${fetchErr}`);
    }

    // Update folder sync time
    await db.folder.update({
      where: { id: folder.id },
      data: { lastSyncedAt: new Date() },
    });

    return { folderId: folder.id, newMessages, errors, remaining, totalOnServer: allUids.length, totalCached: existingUids.size + newMessages };
  } finally {
    mailbox.release();
  }
}

/**
 * Process and store a single message
 */
async function processMessage(
  msg: FetchMessageObject,
  userId: string,
  folderId: string,
  isInbox: boolean
) {
  const envelope = msg.envelope;
  const flags = msg.flags;

  // Skip if no envelope (shouldn't happen but be safe)
  if (!envelope) {
    throw new Error("Message has no envelope");
  }

  // Skip if no source (shouldn't happen but be safe)
  if (!msg.source) {
    throw new Error("Message has no source");
  }

  // Parse the full message for body content
  const parsed = await simpleParser(msg.source);

  // Extract sender info
  const fromHeader = envelope.from?.[0];
  const fromAddress = fromHeader?.address?.toLowerCase() || "unknown@unknown.com";
  const fromName = fromHeader?.name || null;

  // Get or create sender
  const sender = await getOrCreateSender(userId, fromAddress, fromName);

  // Only categorize inbox messages; sent/other folders skip categorization
  const isInScreener = isInbox && sender.status === "PENDING";
  const isInImbox = isInbox && sender.status === "APPROVED" && sender.category === "IMBOX";
  const isInFeed = isInbox && sender.status === "APPROVED" && sender.category === "FEED";
  const isInPaperTrail =
    isInbox && sender.status === "APPROVED" && sender.category === "PAPER_TRAIL";

  // Check for attachments
  const hasAttachments =
    parsed.attachments && parsed.attachments.length > 0;

  // Compute threadId by looking up existing messages in the same conversation
  const references = parsed.references
    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
    : [];
  const inReplyTo = envelope.inReplyTo || null;

  let threadId: string | null = null;

  // Look up existing messages by inReplyTo or references to find an existing threadId
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
      // Use the first reference (thread root) as the threadId
      threadId = references[0] || inReplyTo;
    }
  }

  // Fall back to own messageId if not part of any thread
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
      // Replace the local placeholder with real IMAP data
      const updated = await db.message.update({
        where: { id: localDuplicate.id },
        data: { uid: msg.uid, folderId },
      });
      return updated;
    }
  }

  // Fallback dedup: some mail servers rewrite Message-ID headers.
  // Match by fromAddress + sentAt (±60s) + subject + snippet for negative-UID records.
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
      // Update inReplyTo references that pointed to the old messageId
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
      receivedAt: msg.internalDate || new Date(),
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
      folderId,
      userId,
      senderId: sender.id,
    },
  });

  // Store attachments metadata
  if (parsed.attachments && parsed.attachments.length > 0) {
    const attachmentData = parsed.attachments.map((att, index) => ({
      messageId: message.id,
      filename: att.filename || `attachment-${index}`,
      contentType: att.contentType || "application/octet-stream",
      size: att.size || 0,
      contentId: att.cid || null,
      partId: String(index + 1),
      encoding: (att as unknown as { contentTransferEncoding?: string }).contentTransferEncoding || null,
    }));

    await db.attachment.createMany({
      data: attachmentData,
    });
  }

  return message;
}

/**
 * Walk inReplyTo chains to unify threadIds across entire conversations.
 * Messages synced before threading was fixed may each have their own
 * messageId as threadId — this repairs them.
 */
async function repairThreadIds(userId: string) {
  const messages = await db.message.findMany({
    where: { userId },
    select: { id: true, messageId: true, threadId: true, inReplyTo: true },
  });

  // Index by messageId for chain walking
  const byMessageId = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (m.messageId) byMessageId.set(m.messageId, m);
  }

  // Walk up the inReplyTo chain to find the conversation root
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

  // Group messages by their root's messageId (the canonical threadId)
  const fixes: { id: string; threadId: string }[] = [];
  for (const msg of messages) {
    const rootMessageId = findRootMessageId(msg);
    if (rootMessageId && msg.threadId !== rootMessageId) {
      fixes.push({ id: msg.id, threadId: rootMessageId });
    }
  }

  if (fixes.length > 0) {
    // Batch by threadId to minimize queries
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
 * Perform a full sync for a user's email account
 */
export async function syncUserEmail(userId: string, options?: { batchSize?: number }): Promise<{
  success: boolean;
  results: SyncResult[];
  error?: string;
}> {
  const credentials = await getUserCredentials(userId);

  if (!credentials) {
    return { success: false, results: [], error: "User credentials not found" };
  }

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

    // Get list of mailboxes
    const mailboxes = await client.list();

    // Find important mailboxes to sync
    const toSync: { path: string; specialUse?: string }[] = [
      { path: "INBOX" },
    ];

    // Also sync Sent if found
    for (const mb of mailboxes) {
      if (
        mb.specialUse === "\\Sent" ||
        mb.path.toLowerCase().includes("sent")
      ) {
        toSync.push({ path: mb.path, specialUse: mb.specialUse });
        break;
      }
    }

    // Also sync All Mail if found (Gmail's archive of everything)
    for (const mb of mailboxes) {
      if (mb.specialUse === "\\All") {
        toSync.push({ path: mb.path, specialUse: mb.specialUse });
        break;
      }
    }

    // Sync each mailbox
    for (const { path, specialUse } of toSync) {
      try {
        const result = await syncMailbox(client, userId, path, specialUse, options?.batchSize, credentials.email);
        console.log(`[sync] ${path}: ${result.newMessages} new, ${result.remaining} remaining, ${result.errors.length} errors`);
        results.push(result);
      } catch (err) {
        console.error(`[sync] ${path}: error:`, err);
        results.push({
          folderId: "",
          newMessages: 0,
          errors: [`Failed to sync ${path}: ${err}`],
          remaining: 0,
          totalOnServer: 0,
          totalCached: 0,
        });
      }
    }

    // Only repair threadIds when no remaining messages (import complete or regular sync)
    const hasRemaining = results.some((r) => r.remaining > 0);
    if (!hasRemaining) {
      await repairThreadIds(userId);
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
