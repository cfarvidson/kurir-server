import { db } from "@/lib/db";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";
import { isOwnAddress, type OwnAddresses } from "@/lib/mail/user-emails";
import { plainTextFromBodies } from "@/lib/mcp/serialize";

/**
 * Context pack for draft generation: the current message plus recent prior
 * correspondence with one address, reduced to readable, quote-stripped,
 * truncated plain text. Bodies come from the replica — never an IMAP fetch.
 */

export const CONTEXT_FROM_SENDER_CAP = 8;
export const CONTEXT_OWN_SENT_CAP = 5;
export const CONTEXT_BODY_MAX_CHARS = 2000;

export type ContextEntry = {
  subject: string;
  date: string;
  body: string;
};

export type ContextPack = {
  correspondent: string;
  /** Null when composing new mail — generate from prior correspondence only. */
  current: { subject: string; from: string; body: string } | null;
  fromCorrespondent: ContextEntry[];
  ownSent: ContextEntry[];
};

/**
 * Reduce one message body to prompt-ready text: prefer textBody, strip HTML
 * to text otherwise, drop the trailing quoted tail, and truncate so a single
 * long mail cannot dominate the prompt.
 */
export function contextBodyText(msg: {
  textBody?: string | null;
  htmlBody?: string | null;
}): string {
  const text = plainTextFromBodies(msg);
  const { body } = splitPlainTextQuotes(text);
  return body.trim().slice(0, CONTEXT_BODY_MAX_CHARS);
}

/**
 * The correspondent of a reply is the non-own fromAddress of the message
 * being answered. Replying to the user's own sent mail targets the first
 * non-own recipient instead. `to` is where the reply draft is addressed
 * (Reply-To wins over From). Null when everyone on the mail is the user.
 */
export function resolveReplyAddresses(
  message: {
    fromAddress: string;
    replyTo?: string | null;
    toAddresses: string[];
  },
  own: OwnAddresses,
): { correspondent: string; to: string } | null {
  if (!isOwnAddress(message.fromAddress, own)) {
    return {
      correspondent: message.fromAddress,
      to: message.replyTo || message.fromAddress,
    };
  }
  const other = message.toAddresses.find((a) => !isOwnAddress(a, own));
  if (!other) return null;
  return { correspondent: other, to: other };
}

/** First address of a typed To field ("a@x, b@y" → "a@x"). */
export function firstToAddress(to: string | undefined): string | null {
  const first = (to ?? "")
    .split(/[,;]/)
    .map((part) => part.trim())
    .find(Boolean);
  return first ?? null;
}

const contextSelect = {
  subject: true,
  receivedAt: true,
  textBody: true,
  htmlBody: true,
} as const;

/**
 * `toAddresses` has no case-insensitive array operator, so own-sent mail is
 * scanned newest-first and filtered in JS. Bounded so one query stays cheap.
 */
const OWN_SENT_SCAN_CAP = 100;

function toEntry(row: {
  subject: string | null;
  receivedAt: Date;
  textBody: string | null;
  htmlBody: string | null;
}): ContextEntry {
  return {
    subject: row.subject ?? "",
    date: row.receivedAt.toISOString().slice(0, 10),
    body: contextBodyText(row),
  };
}

/**
 * Load the pack: up to 8 earlier messages from the correspondent and up to 5
 * the user sent to them (sent folder or own from-address), newest first, the
 * current message excluded from both and always carried separately.
 */
export async function buildContextPack(
  userId: string,
  correspondent: string,
  own: OwnAddresses,
  current: {
    id: string;
    subject: string | null;
    fromAddress: string;
    fromName: string | null;
    receivedAt: Date;
    textBody: string | null;
    htmlBody: string | null;
  } | null,
): Promise<ContextPack> {
  // "Earlier" is literal: when replying to an older mail in a thread, mail
  // newer than it must not enter the prompt under an "earlier" heading.
  const earlierThanCurrent = current
    ? { id: { not: current.id }, receivedAt: { lt: current.receivedAt } }
    : {};
  const correspondentLower = correspondent.toLowerCase();
  const [fromRows, sentScan] = await Promise.all([
    db.message.findMany({
      where: {
        userId,
        isDeleted: false,
        fromAddress: { equals: correspondent, mode: "insensitive" },
        ...earlierThanCurrent,
      },
      orderBy: { receivedAt: "desc" },
      take: CONTEXT_FROM_SENDER_CAP,
      select: contextSelect,
    }),
    db.message.findMany({
      where: {
        userId,
        isDeleted: false,
        OR: [
          { folder: { specialUse: "sent" } },
          { fromAddress: { in: own.emails, mode: "insensitive" } },
        ],
        ...earlierThanCurrent,
      },
      orderBy: { receivedAt: "desc" },
      take: OWN_SENT_SCAN_CAP,
      select: { ...contextSelect, toAddresses: true },
    }),
  ]);
  const sentRows = sentScan
    .filter((row) =>
      row.toAddresses.some((a) => a.toLowerCase() === correspondentLower),
    )
    .slice(0, CONTEXT_OWN_SENT_CAP);
  return {
    correspondent,
    current: current
      ? {
          subject: current.subject ?? "",
          from: current.fromName
            ? `${current.fromName} <${current.fromAddress}>`
            : current.fromAddress,
          body: contextBodyText(current),
        }
      : null,
    fromCorrespondent: fromRows.map(toEntry),
    ownSent: sentRows.map(toEntry),
  };
}
