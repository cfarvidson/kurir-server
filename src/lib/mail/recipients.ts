import { z } from "zod";

const emailSchema = z.email();

export interface ParsedRecipients {
  /** Valid, deduped recipient addresses, in input order. */
  recipients: string[];
  /** Segments that are not valid bare email addresses. */
  invalid: string[];
}

/**
 * Parse a recipient string into individual addresses.
 *
 * Splits on commas and semicolons, trims whitespace, drops empty segments,
 * and dedupes case-insensitively (keeping the first form seen). Each segment
 * must be a bare email address — display-name formats like `Name <a@b.com>`
 * are reported as invalid.
 */
export function parseRecipients(input: string): ParsedRecipients {
  const recipients: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const segment of input.split(/[,;]/)) {
    const address = segment.trim();
    if (!address) continue;

    if (!emailSchema.safeParse(address).success) {
      invalid.push(address);
      continue;
    }

    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(address);
  }

  return { recipients, invalid };
}
