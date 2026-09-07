/**
 * Quoted-text detection for plain-text bodies, shared by the thread view
 * (collapse behind "Show full message"), snippets, the compose assistant and
 * signature extraction. The line rules here are mirrored by the iOS client
 * in `QuoteDetection.swift`; keep the two in step.
 *
 * Only strong signals count, plus a closing phrase when a name follows it.
 * A missed quote is a cosmetic nuisance; hiding the author's own words is
 * not.
 */

export const QUOTE_LINE = /^\s*>/;
// "On … wrote:" / "Den … skrev Bob <bob@x.y>:" - the verb may precede the
// name, so only the trailing colon is anchored. The two vocabularies are
// exported so the HTML boundary finder builds its regex from the same lists.
export const ATTRIBUTION_START_WORDS = "On|Den|Am|Le|El";
export const ATTRIBUTION_VERBS = "wrote|skrev|schrieb|a écrit|escribió";
const ATTRIBUTION_START = new RegExp(`^(${ATTRIBUTION_START_WORDS})\\s`);
const ATTRIBUTION_END = new RegExp(
  `\\b(${ATTRIBUTION_VERBS})\\b[^\\n]*:\\s*$`,
  "i",
);
// Outlook / forwarded header blocks: a From: line followed by another label.
export const FORWARD_HEADER_FROM = /^\s*(From|Från|Fra|Von|De)\s*:/i;
export const FORWARD_HEADER_NEXT =
  /^\s*(Sent|Skickat|Sendt|Gesendet|Date|Datum|To|Till|Til|An|Subject|Ämne|Emne|Betreff|Cc)\s*:/i;
const DIVIDERS: RegExp[] = [
  /^\s*-{2,}\s*(Original Message|Ursprungligt meddelande|Ursprüngliche Nachricht|Message d'origine)\s*-{2,}\s*$/i,
  /^\s*-{3,}\s*(Forwarded message|Vidarebefordrat meddelande|Weitergeleitete Nachricht)\s*-{3,}\s*$/i,
  /^\s*(Begin forwarded message|Vidarebefordrat meddelande|Anfang der weitergeleiteten Nachricht)\s*:\s*$/i,
  /^_{10,}\s*$/,
];

// Closing phrases that end the author's text; the signature starts there.
// The phrase must be followed by the end of the line, whitespace or
// punctuation (JS "\b" is ASCII-only, so "BRÖD" would otherwise match "br").
const CLOSING = new RegExp(
  "^(" +
    "med vänliga? hälsningar?|vänliga hälsningar|vänliga hälsningar och tack|med vänlig hälsning|hälsningar|vänligen|allt gott|ha det (?:bra|gott)|tack på förhand|tack så mycket|tack|mvh|mvh\.|vh|best regards|kind regards|warm regards|warmest regards|regards|best wishes|best|all the best|cheers|thanks(?: a lot| again| so much)?|thank you|many thanks|sincerely|yours sincerely|yours truly|yours|br|rgds|take care|talk soon|with kind regards|with best regards|mit freundlichen grüßen|viele grüße|cordialement" +
    ")(?=$|[\\s,.!])[,.!]?\\s*(.*)$",
  "i",
);
const LETTER = "A-Za-zÀ-ÖØ-öø-ÿ";
const UPPER = "A-ZÀ-ÖØ-Þ";
// "/Nicklas", "//Nicklas Bertilsson", "/Bjørn" on a line of its own: one to
// four words; a lowercase start is only accepted for one or two words so
// "//comment in code" stays prose.
const SLASH_SIGNOFF = new RegExp(
  `^\\/{1,2}\\s?[${LETTER}][${LETTER}.-]*(?:\\s+[${LETTER}][${LETTER}.-]*){0,3}$`,
);
const STARTS_UPPER = new RegExp(`^[${UPPER}]`);
const LOWERCASE_WORD = new RegExp(`^[a-zà-öø-ÿ][${LETTER}]{3,}$`);

export type ClosingKind = "none" | "bare" | "named";

/**
 * Classify a line as a closing: "named" when it carries a name ("Mvh Bob",
 * "Kind regards, Bob Smith", "/Bob"), "bare" for the phrase alone ("Med
 * vänliga hälsningar", "Tack"). Up to three capitalised words may follow
 * the phrase.
 */
export function closingKind(line: string): ClosingKind {
  const s = line.trim();
  if (SLASH_SIGNOFF.test(s)) {
    const words = s.replace(/^\/+\s?/, "").split(/\s+/);
    return STARTS_UPPER.test(words[0]) || words.length <= 2 ? "named" : "none";
  }
  const m = CLOSING.exec(s);
  if (!m) return "none";
  const rest = m[2].trim();
  if (rest.length === 0) return "bare";
  const words = rest.split(/\s+/);
  return words.length <= 3 && words.every((w) => STARTS_UPPER.test(w))
    ? "named"
    : "none";
}

export function isClosingLine(line: string): boolean {
  return closingKind(line) !== "none";
}

/**
 * A line that reads as a name, title or company rather than prose: at most
 * five words, one of them capitalised, no sentence punctuation at a word
 * end, and no lowercase word of four letters or more ("Kan du skicka den?"
 * and "Och en sak till" fail; "Nicklas Bertilsson", "Teckentrup /
 * Portexpert.se" and "Head of Sales" pass).
 */
export function isNameLike(line: string): boolean {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  if (words.length === 0 || words.length > 5) return false;
  if (words.some((w) => /[?!:;,]$|\.\.\.$/.test(w))) return false;
  if (!words.some((w) => STARTS_UPPER.test(w))) return false;
  return !words.some((w) => LOWERCASE_WORD.test(w.replace(/\.+$/, "")));
}

/**
 * Index of the line where the signature starts, or `cut` when there is
 * none: the last closing line with body text above it that is either
 * "named" or followed (before `cut`) by a name-like line. A bare "Tack" at
 * the end, or mid-mail followed by prose, stays visible.
 */
export function signatureStart(lines: string[], cut: number): number {
  for (let i = cut - 1; i > 0; i--) {
    const kind = closingKind(lines[i]);
    if (kind === "none") continue;
    if (!lines.slice(0, i).some((l) => l.trim() !== "")) continue;
    if (kind === "named") return i;
    const next = lines.slice(i + 1, cut).find((l) => l.trim() !== "");
    if (next !== undefined && isNameLike(next)) return i;
  }
  return cut;
}

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
 * 1. A trailing `>` block (blank lines allowed; a "-- " signature below it
 *    still counts as trailing), pulling in an "On … wrote:" attribution line
 *    just above it. Inline `>` replies with text after them are left alone.
 * 2. The first forwarded/Outlook header block (From:/Från: + Sent:/Skickat: …)
 *    or "----- Original Message -----" style divider.
 * 3. The first "-- " signature delimiter above that.
 * 4. The last closing phrase ("Med vänliga hälsningar", "Mvh Bob", "/Bob")
 *    with body text above it.
 * 5. A "Sent from my iPhone" / "Get Outlook for iOS" line when it is the last
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

  // A "-- " signature below the quote (Thunderbird's reply-above layout)
  // must not stop the trailing-block walk; the block is trailing when only
  // the signature follows it.
  let sigStart = lines.findIndex((l) => SIGNATURE_DELIMITER.test(l));
  if (sigStart < 0) sigStart = lines.length;

  // 1. Trailing > block.
  let quoteStart = sigStart;
  for (let i = sigStart - 1; i >= 0; i--) {
    if (lines[i].startsWith(">") || lines[i].trim() === "") {
      quoteStart = i;
    } else {
      break;
    }
  }
  if (lines.slice(quoteStart, sigStart).some((l) => l.startsWith(">"))) {
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
  if (sigStart < cut) cut = sigStart;

  // 4. Closing phrase: the last "Med vänliga hälsningar" / "Mvh Bob" /
  //    "/Bob" line with body text above it starts the signature.
  cut = signatureStart(lines, cut);

  // 5. "Sent from …" as the last line of the author's text.
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
