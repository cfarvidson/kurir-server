import { db } from "@/lib/db";
import {
  extractSignature,
  mergeSignatureDetails,
  type SignatureDetails,
} from "@/lib/mail/signature-extract";
import { getOwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";

/**
 * Persists signature details on Sender rows. Two entry points:
 *
 * - `recordSenderSignature` runs inline when sync stores a body from someone
 *   else (never the user's own mail). It swallows errors: a bad body must not
 *   fail the sync.
 * - `backfillSignatures` scans senders that were never processed
 *   (`signatureExtractedAt IS NULL`) over their most recent bodies, in small
 *   batches. `kickSignatureBackfill` starts it once per process per user,
 *   detached from the sync that triggered it.
 *
 * `signatureExtractedAt` is the `receivedAt` of the newest body scanned so
 * far (null = never scanned). Sync walks folders newest-first, so a body
 * older than that stamp only fills gaps; a newer body's values win.
 */

interface SenderSignatureRow {
  id: string;
  signaturePhones: string[];
  signatureTitle: string | null;
  signatureCompany: string | null;
  signatureExtractedAt: Date | null;
}

export function signatureDetailsOf(sender: SenderSignatureRow): SignatureDetails {
  return {
    phones: sender.signaturePhones,
    title: sender.signatureTitle ?? undefined,
    company: sender.signatureCompany ?? undefined,
  };
}

/**
 * Fold one body's extraction into the stored details, honouring the
 * newest-wins rule via the stored stamp. Pure; returns what to persist.
 */
export function foldSignature(
  sender: SenderSignatureRow,
  extracted: SignatureDetails,
  receivedAt: Date,
): { details: SignatureDetails; extractedAt: Date } {
  const existing = signatureDetailsOf(sender);
  const stamp = sender.signatureExtractedAt;
  const newer = !stamp || receivedAt.getTime() >= stamp.getTime();
  return {
    details: newer
      ? mergeSignatureDetails(existing, extracted)
      : mergeSignatureDetails(extracted, existing),
    extractedAt: newer ? receivedAt : stamp,
  };
}

async function save(
  senderId: string,
  details: SignatureDetails,
  extractedAt: Date,
): Promise<void> {
  await db.sender.update({
    where: { id: senderId },
    data: {
      signaturePhones: details.phones,
      signatureTitle: details.title ?? null,
      signatureCompany: details.company ?? null,
      signatureExtractedAt: extractedAt,
    },
  });
}

/** Inline extraction for one freshly synced body from `sender`. */
export async function recordSenderSignature(
  sender: SenderSignatureRow,
  bodyText: string,
  receivedAt: Date,
): Promise<void> {
  try {
    const folded = foldSignature(sender, extractSignature(bodyText), receivedAt);
    await save(sender.id, folded.details, folded.extractedAt);
  } catch (err) {
    console.error(`[signature] sender ${sender.id}: extraction failed`, err);
  }
}

export interface BackfillOptions {
  batchSize?: number;
  messagesPerSender?: number;
  /** Pause between batches so a sync running alongside keeps the DB. */
  pauseMs?: number;
}

/** Scan every unprocessed sender for `userId`. Returns senders processed. */
export async function backfillSignatures(
  userId: string,
  options: BackfillOptions = {},
): Promise<number> {
  const { batchSize = 50, messagesPerSender = 5, pauseMs = 50 } = options;
  const own = await getOwnAddresses(userId);
  let processed = 0;

  for (;;) {
    const senders = await db.sender.findMany({
      where: { userId, signatureExtractedAt: null },
      select: {
        id: true,
        email: true,
        signaturePhones: true,
        signatureTitle: true,
        signatureCompany: true,
        signatureExtractedAt: true,
      },
      orderBy: [{ messageCount: "desc" }, { id: "asc" }],
      take: batchSize,
    });
    if (senders.length === 0) break;

    for (const sender of senders) {
      if (isOwnAddress(sender.email, own)) {
        // Mark as scanned so it never comes back; never profile the user.
        await save(sender.id, signatureDetailsOf(sender), new Date());
        processed++;
        continue;
      }
      const bodies = await db.message.findMany({
        where: { userId, senderId: sender.id, textBody: { not: null } },
        select: { textBody: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
        take: messagesPerSender,
      });
      // Oldest first so the newest mail's values win in the merge.
      let details = signatureDetailsOf(sender);
      for (const body of [...bodies].reverse()) {
        details = mergeSignatureDetails(details, extractSignature(body.textBody));
      }
      await save(sender.id, details, bodies[0]?.receivedAt ?? new Date());
      processed++;
    }

    if (senders.length < batchSize) break;
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }

  return processed;
}

const kicked = new Set<string>();

/**
 * Start the backfill for `userId` once per process, detached: the caller
 * (sync) returns immediately and never sees the result or an error.
 */
export function kickSignatureBackfill(userId: string): void {
  if (kicked.has(userId)) return;
  kicked.add(userId);
  void backfillSignatures(userId)
    .then((count) => {
      if (count > 0) {
        console.log(`[signature] backfilled ${count} senders for ${userId}`);
      }
    })
    .catch((err) => {
      kicked.delete(userId); // let the next sync try again
      console.error(`[signature] backfill failed for ${userId}`, err);
    });
}

/** Test hook: forget which users were kicked in this process. */
export function resetSignatureBackfillKicks(): void {
  kicked.clear();
}
