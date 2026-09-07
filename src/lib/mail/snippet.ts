import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";

/**
 * Create a preview snippet from an email body.
 *
 * The quoted tail and signature are dropped first so a reply previews the
 * author's words, not "From: … Sent: …".
 *
 * The single implementation shared by ingest (sync-service) and the local
 * sent-message persist (persist-sent). The Sent-folder reconciliation matches
 * rows on this value, so both sides MUST compute it identically — persist-sent
 * used to keep a raw-substring variant, which meant a multi-line body could
 * never reconcile and an MTA-rewritten Message-ID produced a duplicate row.
 */
export function createSnippet(
  text: string | undefined,
  maxLength = 150,
): string | null {
  if (!text) return null;
  const cleaned = splitPlainTextQuotes(text)
    .body.replace(/\s+/g, " ")
    .replace(/^[\s>]+/gm, "")
    .trim();
  return cleaned.length > maxLength
    ? cleaned.substring(0, maxLength) + "..."
    : cleaned;
}
