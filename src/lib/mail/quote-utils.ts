/**
 * Quoted-text detection for plain-text bodies, shared by the thread view
 * (collapse behind "Show full message"), snippets, the compose assistant and
 * signature extraction. The line rules here are mirrored by the iOS client
 * in `QuoteDetection.swift`; keep the two in step.
 *
 * Only strong signals count. A missed quote is a cosmetic nuisance; hiding
 * the author's own words is not.
 */

export const QUOTE_LINE = /^\s*>/;
// "On … wrote:" / "Den … skrev Bob <bob@x.y>:" - the verb may precede the
// name, so only the trailing colon is anchored.
const ATTRIBUTION_START = /^(On|Den|Am|Le|El)\s/;
const ATTRIBUTION_END = /\b(wrote|skrev|schrieb|a écrit|escribió)\b[^\n]*:\s*$/i;
// Outlook / forwarded header blocks: a From: line followed by another label.
export const FORWARD_HEADER_FROM = /^\s*(From|Från|Fra|Von|De)\s*:/i;
export const FORWARD_HEADER_NEXT =
  /^\s*(Sent|Skickat|Sendt|Gesendet|Date|Datum|To|Till|Til|An|Subject|Ämne|Emne|Betreff|Cc)\s*:/i;
const DIVIDERS: RegExp[] = [
  /^\s*-{2,}\s*(Original Message|Ursprungligt meddelande|Ursprünglische Nachricht|Message d'origine)\s*-{2,}\s*$/i,
  /^\s*-{3,}\s*(Forwarded message|Vidarebefordrat meddelande|Weitergeleitete Nachricht)\s*-{3,}\s*$/i,
  /^\s*(Begin forwarded message|Vidarebefordrat meddelande|Anfang der weitergeleiteten Nachricht)\s*:\s*$/i,
  /^_{10,}\s*$/,
];

/** The RFC 3676 signature separator: "-- " (trailing space optional). */
export const SIGNATURE_DELIMITER = /^--\s?$/;
/** "Sent from my iPhone" / "Skickat från min iPhone" and friends. */
export const SENT_FROM =
  /^(sent|skickat|sendt|gesendet|envoyé)\s+(from|från|fra|von|de)\s+/i;
/** "Get Outlook for iOS" / "Hämta Outlook för iOS". */
export const MOBILE_APP_LINE = /^(get|hämta|skaffa)\s+outlook\s+(for|för)\s+/i;

/** Attribution starting at line `i`, with its trailing colon within 3 lines. */
export function isAttribution(all: string[], i: number): boolean {
  if (!ATTRIBUTION_START.test(all[i])) return false;
  for (let j = i; j < Math.min(all.length, i + 3); j++) {
    if (ATTRIBUTION_END.test(all[j])) return true;
  }
  return false;
}

/** A From:/Från: line with another header label within the next 3 lines. */
export function isForwardHeader(all: string[], i: number): boolean {
  if (!FORWARD_HEADER_FROM.test(all[i])) return false;
  for (let j = i + 1; j < Math.min(all.length, i + 4); j++) {
    if (FORWARD_HEADER_NEXT.test(all[j])) return true;
  }
  return false;
}

export function isDivider(line: string): boolean {
  return DIVIDERS.some((d) => d.test(line));
}

/**
 * Split a plain-text email body into the author's own text and the trailing
 * quoted / signature part.
 *
 * Cut points, earliest wins:
 * 1. A trailing `>` block (blank lines allowed), pulling in an "On … wrote:"
 *    attribution line just above it. Inline `>` replies with text after them
 *    are left alone.
 * 2. The first forwarded/Outlook header block (From:/Från: + Sent:/Skickat: …)
 *    or "----- Original Message -----" style divider.
 * 3. The first "-- " signature delimiter above that.
 * 4. A "Sent from my iPhone" / "Get Outlook for iOS" line when it is the last
 *    line of the author's text.
 *
 * Nothing is collapsed when the whole body would disappear.
 */
export function splitPlainTextQuotes(text: string): {
  body: string;
  quoted: string | null;
} {
  // CRLF bodies: a trailing "\r" would make blank lines non-blank and hide
  // the attribution line from the regex.
  const lines = text
    .split("\n")
    .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  let cut = lines.length;

  // 1. Trailing > block.
  let quoteStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(">") || lines[i].trim() === "") {
      quoteStart = i;
    } else {
      break;
    }
  }
  if (lines.slice(quoteStart).some((l) => l.startsWith(">"))) {
    cut = quoteStart;
    // Attribution directly above the block, one or two lines when wrapped,
    // ending in the colon. The nearest start wins so an unrelated "On the
    // other hand…" line above the real attribution stays visible.
    let end = cut - 1;
    while (end >= 0 && lines[end].trim() === "") end--;
    for (let j = end; j >= Math.max(0, end - 1); j--) {
      if (
        ATTRIBUTION_START.test(lines[j]) &&
        ATTRIBUTION_END.test(lines.slice(j, end + 1).join(" "))
      ) {
        cut = j;
        break;
      }
    }
  }

  // 2. Forwarded / Outlook header block or divider.
  for (let i = 0; i < cut; i++) {
    if (isDivider(lines[i]) || isForwardHeader(lines, i)) {
      cut = i;
      break;
    }
  }

  // 3. Signature delimiter.
  for (let i = 0; i < cut; i++) {
    if (SIGNATURE_DELIMITER.test(lines[i])) {
      cut = i;
      break;
    }
  }

  // 4. "Sent from …" as the last line of the author's text.
  let last = cut - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  if (last >= 0) {
    const line = lines[last].trim();
    if (SENT_FROM.test(line) || MOBILE_APP_LINE.test(line)) cut = last;
  }

  if (cut === lines.length) return { body: text, quoted: null };
  // Whole body quoted — nothing to collapse.
  if (lines.slice(0, cut).every((l) => l.trim() === "")) {
    return { body: text, quoted: null };
  }

  const body = lines.slice(0, cut).join("\n").trimEnd();
  const quoted = lines.slice(cut).join("\n");
  return { body, quoted };
}
