import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getUserCredentials } from "@/lib/auth";

interface SyncResult {
  folderId: string;
  newMessages: number;
  errors: string[];
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
  imapSpecialUse?: string
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
      return { folderId: folder.id, newMessages: 0, errors };
    }

    // Build a fetch range: use min:max UID range to limit what we download
    const newUidSet = new Set(newUids);
    const minUid = Math.min(...newUids);
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
        if (!newUidSet.has(msgUid)) {
          continue;
        }
        try {
          await processMessage(msg, userId, folder.id, specialUse === "inbox");
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

    return { folderId: folder.id, newMessages, errors };
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

  // Create message record
  const message = await db.message.create({
    data: {
      uid: msg.uid,
      messageId: envelope.messageId || null,
      threadId: envelope.messageId || null, // Simplified thread ID
      inReplyTo: envelope.inReplyTo || null,
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
 * Perform a full sync for a user's email account
 */
export async function syncUserEmail(userId: string): Promise<{
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

    // Sync each mailbox
    for (const { path, specialUse } of toSync) {
      try {
        const result = await syncMailbox(client, userId, path, specialUse);
        console.log(`[sync] ${path}: ${result.newMessages} new, ${result.errors.length} errors`);
        results.push(result);
      } catch (err) {
        console.error(`[sync] ${path}: error:`, err);
        results.push({
          folderId: "",
          newMessages: 0,
          errors: [`Failed to sync ${path}: ${err}`],
        });
      }
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
