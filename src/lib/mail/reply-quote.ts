/**
 * The quoted original below a reply (kurir-server#177).
 *
 * Every send path that carries an In-Reply-To appends the message being
 * answered below the new text, the way Apple Mail and Outlook do: an
 * attribution line, then the original as a `> `-prefixed block in the text
 * part and as a blockquote in the HTML part. The quote is built from the
 * original's plain text (or a text rendering of its HTML), never from its raw
 * HTML, so tracking pixels, cid: images and foreign styles are not sent on.
 *
 * The shapes are chosen so Kurir's own quote detection folds them away:
 * quote-utils' trailing `>` block with an "On … wrote:" line above it, and
 * sanitize-html's trailing blockquote preceded by an attribution element.
 */
import { db } from "@/lib/db";

export interface QuoteSource {
  fromName?: string | null;
  fromAddress: string;
  sentAt?: Date | null;
  receivedAt?: Date | null;
  textBody?: string | null;
  htmlBody?: string | null;
}

export interface ReplyQuote {
  /** Appended verbatim to the plain-text body (starts with a blank line). */
  text: string;
  /** Inserted before </body> of the HTML body. */
  html: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Line-preserving plain text for originals that only have an HTML part. */
export function htmlToQuoteText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Null when the original has no text to quote. */
export function buildReplyQuote(original: QuoteSource): ReplyQuote | null {
  const raw = original.textBody?.trim()
    ? original.textBody
    : original.htmlBody
      ? htmlToQuoteText(original.htmlBody)
      : "";
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body) return null;

  const date = original.sentAt ?? original.receivedAt;
  const who = original.fromName
    ? `${original.fromName} <${original.fromAddress}>`
    : original.fromAddress;
  const attribution = `On ${date ? `${formatDate(date)}, ` : ""}${who} wrote:`;

  const text =
    `\n\n${attribution}\n\n` +
    body
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  const html =
    `<div>${escapeHtml(attribution)}</div>\n` +
    `<blockquote type="cite" style="border-left:3px solid #d1d5db;margin:0 0 1em;padding:0 0 0 12px;color:#6b7280">` +
    escapeHtml(body).split("\n").join("<br>\n") +
    `</blockquote>`;
  return { text, html };
}

/** Insert before </body> (the markdown wrapper's seam), else at the end. */
export function appendQuoteToHtml(html: string, quoteHtml: string): string {
  const at = html.lastIndexOf("</body>");
  return at < 0
    ? `${html}\n${quoteHtml}`
    : `${html.slice(0, at)}${quoteHtml}\n${html.slice(at)}`;
}

/** The quote for the message with this RFC Message-ID, or null. */
export async function loadReplyQuote(
  userId: string,
  inReplyTo: string | null | undefined,
): Promise<ReplyQuote | null> {
  if (!inReplyTo) return null;
  const original = await db.message.findFirst({
    where: { userId, messageId: inReplyTo },
    select: {
      fromName: true,
      fromAddress: true,
      sentAt: true,
      receivedAt: true,
      textBody: true,
      htmlBody: true,
    },
  });
  return original ? buildReplyQuote(original) : null;
}
