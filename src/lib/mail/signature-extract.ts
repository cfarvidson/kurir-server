/**
 * Signature extraction: phones, job title, and company from the trailing
 * signature block of a plain-text body. Pure; no DB.
 *
 * The heuristics are deliberately conservative (a missed title beats a wrong
 * one):
 *
 * 1. Everything from the first quoted/forwarded marker onward is dropped
 *    (`>` lines, "On ... wrote:", "Den ... skrev:", From:/Från: header
 *    blocks, Outlook and Gmail forward dividers).
 * 2. The signature is the block after the last `-- ` delimiter; failing that,
 *    the lines after the last closing phrase ("Best regards", "Mvh", ...)
 *    within the final 12 lines; failing that, the last short paragraph when
 *    there is body text above it. A one-paragraph mail has no signature.
 * 3. Phones are digit runs of 7-15 digits that start with `+`, `00`, or `0`,
 *    or follow a label (Tel, Mob, Phone, M, ...), excluding dates and lines
 *    about org/VAT/bank numbers. Deduped on the last nine digits, max three.
 * 4. Title/company come from the plain text lines of the block (no digits,
 *    no @, no URL). The first such line is assumed to be the name unless it
 *    carries a title or company marker. Title = first line matching a
 *    title vocabulary; company = first line with a company suffix (AB, Inc,
 *    GmbH, ...), else the plain line right after the title. "Title | Company",
 *    "Title, Company" and "Title at Company" one-liners are split.
 */

export interface SignatureDetails {
  phones: string[];
  title?: string;
  company?: string;
}

export const MAX_SIGNATURE_PHONES = 3;

const QUOTE_LINE = /^\s*>/;
const ATTRIBUTION_START = /^(On|Den|Am|Le|El)\s/;
// "On … wrote:" / "Den … skrev Bob <bob@x.y>:" - the verb may precede the
// name, so only the trailing colon is anchored.
const ATTRIBUTION_END = /\b(wrote|skrev|schrieb|a écrit|escribió)\b[^\n]*:\s*$/i;
const FORWARD_HEADER_FROM = /^\s*(From|Från|Fra|Von|De)\s*:/i;
const FORWARD_HEADER_NEXT = /^\s*(Sent|Skickat|Sendt|Gesendet|Date|Datum|To|Till|Til|An|Subject|Ämne|Emne|Betreff|Cc)\s*:/i;
const DIVIDERS: RegExp[] = [
  /^\s*-{2,}\s*(Original Message|Ursprungligt meddelande|Ursprünglische Nachricht|Message d'origine)\s*-{2,}\s*$/i,
  /^\s*-{3,}\s*(Forwarded message|Vidarebefordrat meddelande|Weitergeleitete Nachricht)\s*-{3,}\s*$/i,
  /^\s*(Begin forwarded message|Vidarebefordrat meddelande|Anfang der weitergeleiteten Nachricht)\s*:\s*$/i,
  /^_{10,}\s*$/,
];

const SIGNATURE_DELIMITER = /^--\s?$/;
const CLOSING = /^(med vänliga? hälsningar?|vänliga hälsningar|vänliga hälsningar och tack|med vänlig hälsning|hälsningar|vänligen|allt gott|ha det (?:bra|gott)|tack på förhand|tack så mycket|tack|mvh|mvh\.|vh|best regards|kind regards|warm regards|warmest regards|regards|best wishes|best|all the best|cheers|thanks(?: a lot| again| so much)?|thank you|many thanks|sincerely|yours sincerely|yours truly|yours|br|rgds|take care|talk soon|with kind regards|with best regards|mit freundlichen grüßen|viele grüße|cordialement)\b[,.!]?\s*(.*)$/i;
const SENT_FROM = /^(sent|skickat|sendt|gesendet|envoyé)\s+(from|från|fra|von|de)\s+/i;

const PHONE = /(?:\+\s?)?\(?\d[\d\s().\-]{5,}\d/g;
const PHONE_LABEL_BEFORE = /(?:^|[\s|•·])(tel|tfn|telefon|telephone|phone|ph|mob|mobil|mobile|cell|direct|direkt|dir|office|kontor|växel|fax|m|t|d|o|w|p)\.?\s*[:.]?\s*$/i;
const NOT_A_PHONE_LINE = /org\.?\s*nr|organisationsnummer|org\.?\s*no|\bvat\b|moms|reg\.?\s*no|\biban\b|bankgiro|plusgiro|\bbg\s*:|\bpg\s*:|invoice|faktura|kundnr|customer\s*(?:no|id)|order\s*(?:no|#|nr)|account\s*(?:no|number)|konto/i;
const DATE_LIKE = [/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/];

const TITLE_WORDS = /(chef\b|ansvarig|ledare\b|utvecklare|konsult\b|säljare|ingenjör|rektor|lärare|förvaltare|mäklare|redovisnings|ekonom\b|jurist|advokat|handläggare|rådgivare|kommunikatör|grundare|ordförande|controller|assistent|koordinator|specialist|strateg\b|analytiker|arkitekt|designer|manager|director|engineer|developer|consultant|founder|partner\b|owner|officer|president|analyst|architect|coordinator|assistant|associate|advisor|adviser|recruiter|editor|teacher|professor|doctor|scientist|researcher|producer|programmer|accountant|attorney|lawyer|nurse|physician|therapist|\bhead of\b|\blead\b|\bvp\b|\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|\bcmo\b|\bcio\b|\bchief\b|\bsales\b|\bmarketing\b|\bproduct\b|\bproject\b|\bcustomer success\b|\bstudent\b|\bintern\b|praktikant)/i;
const COMPANY_SUFFIX = /(^|[\s,])(AB|Inc\.?|LLC|Ltd\.?|GmbH|AG|AS|ASA|Oy|ApS|A\/S|S\.A\.|SAS|BV|B\.V\.|PLC|Corp\.?|Corporation|Co\.|Company|Group|Holding|Holdings|Partners|Studio|Studios|Agency|Solutions|Technologies|Consulting|Ventures|Capital|Labs|Kommun|Region|Universitet|University|Skola|School|Förskola|Förening|Föreningen|Stiftelsen|Institutet|Institute|Foundation|Bank)(?=$|[\s,.)])/;
const TITLE_COMPANY_SPLIT = /^(.+?)(?:,\s+|\s+at\s+|\s+@\s+|\s+hos\s+|\s+på\s+)(.+)$/i;
const SEGMENT_SPLIT = /\s*(?:\||•|·|‧|⋅|\s[–—-]\s|\s\/\s)\s*/;

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function isAttribution(all: string[], i: number): boolean {
  if (!ATTRIBUTION_START.test(all[i])) return false;
  for (let j = i; j < Math.min(all.length, i + 3); j++) {
    if (ATTRIBUTION_END.test(all[j])) return true;
  }
  return false;
}

function isForwardHeader(all: string[], i: number): boolean {
  if (!FORWARD_HEADER_FROM.test(all[i])) return false;
  for (let j = i + 1; j < Math.min(all.length, i + 4); j++) {
    if (FORWARD_HEADER_NEXT.test(all[j])) return true;
  }
  return false;
}

/** The author's own text: everything before the first quote/forward marker. */
export function stripQuotedAndForwarded(text: string): string {
  const all = lines(text);
  let cut = all.length;
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    if (
      QUOTE_LINE.test(line) ||
      DIVIDERS.some((d) => d.test(line)) ||
      isAttribution(all, i) ||
      isForwardHeader(all, i)
    ) {
      cut = i;
      break;
    }
  }
  return all.slice(0, cut).join("\n").trimEnd();
}

function isClosing(line: string): boolean {
  const m = CLOSING.exec(line.trim());
  if (!m) return false;
  const rest = m[1].trim();
  if (rest.length === 0) return true;
  const words = rest.split(/\s+/);
  return words.length <= 3 && words.every((w) => /^[A-ZÅÄÖÉ]/.test(w));
}

/** The trailing signature block of the author's own text, or [] when none. */
export function signatureBlock(ownText: string): string[] {
  const all = lines(ownText);
  while (all.length && all[all.length - 1].trim() === "") all.pop();
  if (all.length === 0) return [];

  // 1. `-- ` delimiter (last one wins).
  for (let i = all.length - 1; i >= 0; i--) {
    if (SIGNATURE_DELIMITER.test(all[i])) {
      return all.slice(i + 1);
    }
  }

  // 2. Closing phrase within the final 12 lines.
  const floor = Math.max(0, all.length - 12);
  for (let i = all.length - 1; i >= floor; i--) {
    if (isClosing(all[i])) {
      return all.slice(i + 1);
    }
  }

  // 3. Last short paragraph, only when there is body text above it.
  let start = all.length;
  while (start > 0 && all[start - 1].trim() !== "") start--;
  const paragraph = all.slice(start);
  const hasBodyAbove = all.slice(0, start).some((l) => l.trim() !== "");
  if (
    hasBodyAbove &&
    paragraph.length >= 1 &&
    paragraph.length <= 6 &&
    paragraph.every((l) => l.trim().length <= 60)
  ) {
    return paragraph;
  }
  return [];
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** Dedupe key: the last nine digits, so `+46 70 …` and `070-…` collide. */
export function phoneKey(phone: string): string {
  const digits = digitsOf(phone);
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function phonesIn(line: string): string[] {
  if (NOT_A_PHONE_LINE.test(line)) return [];
  const found: string[] = [];
  for (const match of line.matchAll(PHONE)) {
    const raw = match[0].trim();
    if (DATE_LIKE.some((d) => d.test(raw))) continue;
    const digits = digitsOf(raw);
    if (digits.length < 7 || digits.length > 15) continue;
    const before = line.slice(0, match.index ?? 0);
    const labelled = PHONE_LABEL_BEFORE.test(before);
    const startsLikePhone = /^(\+|00|0)/.test(raw);
    if (!labelled && !startsLikePhone) continue;
    found.push(raw.replace(/\s+/g, " "));
  }
  return found;
}

function dedupePhones(phones: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phone of phones) {
    const key = phoneKey(phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(phone);
    if (out.length >= MAX_SIGNATURE_PHONES) break;
  }
  return out;
}

function isPlainTextSegment(segment: string): boolean {
  const s = segment.trim();
  if (s.length < 2 || s.length > 60) return false;
  if (/@|https?:|www\./i.test(s)) return false;
  if (digitsOf(s).length > 2) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]{2}/.test(s)) return false;
  if (isClosing(s) || SENT_FROM.test(s)) return false;
  return true;
}

export function extractSignature(bodyText: string | null | undefined): SignatureDetails {
  if (!bodyText) return { phones: [], title: undefined, company: undefined };
  const block = signatureBlock(stripQuotedAndForwarded(bodyText))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (block.length === 0) {
    return { phones: [], title: undefined, company: undefined };
  }

  const phones: string[] = [];
  const segments: string[] = [];
  for (const line of block) {
    const linePhones = phonesIn(line);
    if (linePhones.length > 0) {
      phones.push(...linePhones);
      continue;
    }
    for (const segment of line.split(SEGMENT_SPLIT)) {
      if (isPlainTextSegment(segment)) segments.push(segment.trim());
    }
  }

  let title: string | undefined;
  let company: string | undefined;
  let titleIndex = -1;
  const start =
    segments.length > 0 &&
    !TITLE_WORDS.test(segments[0]) &&
    !COMPANY_SUFFIX.test(segments[0])
      ? 1 // first plain line is the name
      : 0;

  for (let i = start; i < segments.length; i++) {
    const segment = segments[i];
    if (!company && COMPANY_SUFFIX.test(segment) && !TITLE_WORDS.test(segment)) {
      company = segment;
      continue;
    }
    if (!title && TITLE_WORDS.test(segment)) {
      const split = TITLE_COMPANY_SPLIT.exec(segment);
      if (split && TITLE_WORDS.test(split[1]) && !TITLE_WORDS.test(split[2])) {
        title = split[1].trim();
        if (!company && isPlainTextSegment(split[2])) company = split[2].trim();
      } else {
        title = segment;
      }
      titleIndex = i;
      continue;
    }
    if (!company && COMPANY_SUFFIX.test(segment)) {
      company = segment;
    }
  }

  if (!company && titleIndex >= 0) {
    const next = segments[titleIndex + 1];
    if (next && !TITLE_WORDS.test(next) && next.length <= 40) {
      company = next;
    }
  }

  return { phones: dedupePhones(phones), title, company };
}

/**
 * Fold a fresh extraction into what is already stored for the sender: a
 * field the new mail did not carry keeps its old value; phones are unioned
 * newest first.
 */
export function mergeSignatureDetails(
  existing: SignatureDetails,
  extracted: SignatureDetails,
): SignatureDetails {
  return {
    phones: dedupePhones([...extracted.phones, ...existing.phones]),
    title: extracted.title ?? existing.title,
    company: extracted.company ?? existing.company,
  };
}

export type ProfileSource = "contact" | "signature";

export interface SourcedValue {
  value: string;
  source: ProfileSource;
}

export interface ContactDetails {
  name?: string;
  phones: string[];
  title?: string;
  company?: string;
}

export interface MergedProfileDetails {
  name: SourcedValue | null;
  phones: SourcedValue[];
  title: SourcedValue | null;
  company: SourcedValue | null;
}

/** Contact record values win; the signature fills the gaps. */
export function mergeContactDetails(
  contact: ContactDetails | null,
  signature: SignatureDetails,
): MergedProfileDetails {
  const pick = (
    fromContact: string | undefined,
    fromSignature: string | undefined,
  ): SourcedValue | null => {
    if (fromContact && fromContact.trim()) {
      return { value: fromContact.trim(), source: "contact" };
    }
    if (fromSignature && fromSignature.trim()) {
      return { value: fromSignature.trim(), source: "signature" };
    }
    return null;
  };
  const phones: SourcedValue[] =
    contact && contact.phones.length > 0
      ? contact.phones.map((value) => ({ value, source: "contact" as const }))
      : signature.phones.map((value) => ({
          value,
          source: "signature" as const,
        }));
  return {
    name: pick(contact?.name, undefined),
    phones,
    title: pick(contact?.title, signature.title),
    company: pick(contact?.company, signature.company),
  };
}
