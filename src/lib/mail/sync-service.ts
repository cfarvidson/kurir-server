import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getConnectionCredentials } from "@/lib/auth";

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

    // Fetch new messages by UID range. Use minUid:* first; if the server
    // rejects it (UID doesn't exist), fall back to 1:* and filter.
    const batchSet = new Set(batch);
    const minUid = Math.min(...batch);
    const maxUid = Math.max(...batch);
    let fetchRange = `${minUid}:${maxUid}`;

    const fetchOpts = {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
      bodyStructure: true,
      source: true,
    } as const;

    console.log(
      `[sync] ${mailboxPath}: fetching range ${fetchRange} (${batch.length} target UIDs)`,
    );

    async function* resilientFetch() {
      try {
        yield* client.fetch(fetchRange, fetchOpts);
      } catch (rangeErr) {
        console.warn(
          `[sync] ${mailboxPath}: range fetch ${fetchRange} failed, falling back to 1:*`,
          rangeErr,
        );
        fetchRange = "1:*";
        yield* client.fetch("1:*", fetchOpts);
      }
    }

    let fetched = 0;
    try {
      for await (const msg of resilientFetch()) {
        const msgUid = Number(msg.uid);
        fetched++;
        if (fetched % 50 === 0) {
          console.log(
            `[sync] ${mailboxPath}: fetched ${fetched} messages so far...`,
          );
        }
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

          let isInbox = specialUse === "inbox";
          let archived = false;
          if (specialUse === "all" && userEmails?.length) {
            const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
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
    } catch (fetchErr) {
      console.error(`[sync] ${mailboxPath}: fetch error:`, fetchErr);
      errors.push(`Fetch error: ${fetchErr}`);
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
  const isInImbox =
    isInbox && sender.status === "APPROVED" && sender.category === "IMBOX";
  const isInFeed =
    isInbox && sender.status === "APPROVED" && sender.category === "FEED";
  const isInPaperTrail =
    isInbox &&
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
      isArchived,
      folderId,
      userId,
      emailConnectionId,
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
      encoding:
        (att as unknown as { contentTransferEncoding?: string })
          .contentTransferEncoding || null,
    }));

    await db.attachment.createMany({
      data: attachmentData,
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
  const credentials = await getConnectionCredentials(emailConnectionId);

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
