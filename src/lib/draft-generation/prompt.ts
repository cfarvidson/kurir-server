import type { ContextPack } from "@/lib/draft-generation/context";
import type {
  DraftTone,
  InferenceRequest,
} from "@/lib/draft-generation/types";

/**
 * Locked prompt rules. Tests assert facts (NEW vs REPLY framing, unslop
 * constraints present), not that a live model obeys them.
 *
 * The compose assistant (#133) adds two authoritative inputs on top: what
 * the user wants the mail to say, and the register to say it in. Neither
 * loosens the locked rules - an instruction steers content, never truth.
 * Unslop does not license a new voice: auto still matches the user's own
 * sent mail; Formal / Friendly / Direct still do what they do today.
 */

const REPLY_LEAD = [
  'You draft email replies as the mailbox owner ("the user"). Follow every rule:',
  "- Write in the same language as the mail being answered.",
  "- Write a real reply that answers the latest mail, not a summary of it.",
].join("\n");

/**
 * New mail has no incoming mail to answer. The model is writing to the
 * correspondent, not replying to a latest mail.
 */
const NEW_LEAD = [
  'You draft a new email from the mailbox owner ("the user") to the correspondent. This is a new mail, not a reply. Follow every rule:',
  "- Write in the language the user wrote their instruction in; with no instruction, match the language of the earlier correspondence.",
  "- Prior correspondence is relationship and voice, not a license to ignore the instruction.",
].join("\n");

const SHARED_RULES = [
  "- Write as the mailbox owner, in their voice. Not a template, not a press release.",
  "- Treat earlier mail from the correspondent only as facts about the relationship.",
  "- Match the tone and voice of the user's own earlier mail.",
  "- Never invent facts, meetings, or commitments the user did not make.",
  "- Do not quote the original message back and do not add a subject line.",
  "- Return only the mail body as plain text; simple markdown is allowed.",
  "- Never use puffery or promotional words such as pivotal, vibrant, groundbreaking, testament, landscape, delve, showcase, underscore, crucial, intricate, tapestry.",
  '- Do not write "Not just X, but Y." Do not cycle synonyms for the same thing. Do not force ideas into groups of three.',
  "- Do not use em dashes. Periods or commas only.",
  '- Do not use chatbot leftovers such as "I hope this helps!", "Let me know if you have any questions", "Of course!", "Certainly!".',
  '- Do not use filler such as "In order to" or "It is important to note that", and do not pile up hedges.',
  "- Vary sentence length. Be specific. First person is fine when it fits the user's own sent mail.",
].join("\n");

/**
 * Tone lines are fixed; `auto` adds nothing so the default output keeps
 * matching the user's own voice from the context pack.
 */
const TONE_LINES: Record<DraftTone, string | null> = {
  auto: null,
  formal:
    "Write in a formal, professional register: complete sentences, no slang, a polite close.",
  friendly:
    "Write warmly and personally, the way you would to someone you like working with.",
  direct:
    "Write briefly and directly: get to the point in the first sentence and keep it short.",
};

/**
 * Subject protocol for new mail: one delimiter line separates a proposed
 * subject from the body. Parsing failure degrades to body-only, never an
 * error, so a model that ignores the protocol still produces a usable draft.
 */
export const BODY_DELIMITER = "%%%BODY%%%";

const SUBJECT_INSTRUCTIONS = [
  "Propose a subject line for this new mail.",
  `Start your answer with "SUBJECT: " followed by a single-line subject, then a line containing exactly ${BODY_DELIMITER}, then the mail body.`,
].join(" ");

function entrySection(
  title: string,
  entries: { subject: string; date: string; body: string }[],
): string[] {
  if (entries.length === 0) return [];
  const parts = [`# ${title} (newest first)`];
  for (const entry of entries) {
    parts.push(`## ${entry.date} — ${entry.subject}`.trimEnd());
    parts.push(entry.body || "(no text)");
  }
  return parts;
}

export type PromptOptions = {
  /** What the user wants the mail to say. Empty/absent = infer as before. */
  instruction?: string;
  tone?: DraftTone;
  /** Ask for a subject through the delimiter protocol (NEW, empty subject). */
  wantSubject?: boolean;
  /** Offered when the generation may go looking for its own context. */
  tools?: InferenceRequest["tools"];
  maxToolCalls?: number;
};

export function buildInferenceRequest(
  pack: ContextPack,
  options: PromptOptions = {},
): InferenceRequest {
  const instruction = (options.instruction ?? "").trim();
  const toneLine = TONE_LINES[options.tone ?? "auto"];

  const system = [pack.current ? REPLY_LEAD : NEW_LEAD, SHARED_RULES];
  if (toneLine) system.push(toneLine);
  if (instruction) {
    system.push(
      "The user has said what this mail should say. Follow it: it outranks your reading of the correspondence for content, but never licenses inventing facts.",
    );
  }
  if (options.tools?.length) {
    system.push(
      "You may search and read the user's own mail for context the drafted mail needs. Use it only when the mail depends on facts you do not already have, then answer.",
    );
  }
  if (options.wantSubject) system.push(SUBJECT_INSTRUCTIONS);

  const parts: string[] = [];
  if (instruction) {
    parts.push("# What the user wants this mail to say");
    parts.push(instruction);
  }
  if (pack.current) {
    parts.push(`# Latest mail from ${pack.current.from}`);
    parts.push(`Subject: ${pack.current.subject}`);
    parts.push(pack.current.body || "(no text)");
  }
  parts.push(
    ...entrySection(`Earlier mail from ${pack.correspondent}`, pack.fromCorrespondent),
  );
  parts.push(
    ...entrySection(
      `The user's earlier mail to ${pack.correspondent}`,
      pack.ownSent,
    ),
  );
  parts.push(
    pack.current
      ? "Write the user's reply to the latest mail."
      : `Write a new mail from the user to ${pack.correspondent}.`,
  );

  const request: InferenceRequest = {
    system: system.join("\n"),
    user: parts.join("\n\n"),
  };
  if (options.tools?.length) {
    request.tools = options.tools;
    request.maxToolCalls = options.maxToolCalls ?? 0;
  }
  return request;
}

/**
 * Split the model's answer on the subject protocol. Anything that does not
 * match exactly is treated as a body — a missing or malformed subject line
 * must never cost the user their draft.
 */
export function parseGeneratedDraft(raw: string): {
  subject?: string;
  body: string;
} {
  const index = raw.indexOf(BODY_DELIMITER);
  if (index === -1) {
    // Half-compliance: the subject line without the delimiter. Take the
    // line as the subject rather than leaking it into the body.
    const lead = /^SUBJECT:\s*(.+)(?:\r?\n|$)/i.exec(raw.trimStart());
    if (!lead) return { body: raw.trim() };
    const body = raw.trimStart().slice(lead[0].length).trim();
    if (!body) return { body: raw.trim() };
    return { subject: lead[1].trim(), body };
  }
  const head = raw.slice(0, index).trim();
  const tail = raw.slice(index + BODY_DELIMITER.length).trim();
  // The delimiter itself never reaches the composer, whatever went wrong.
  if (!tail) return { body: head.replace(/^SUBJECT:.*$/im, "").trim() };
  const match = /^SUBJECT:\s*(.+)$/im.exec(head);
  if (!match) return { body: tail };
  return { subject: match[1].trim(), body: tail };
}
