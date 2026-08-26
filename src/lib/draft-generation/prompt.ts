import type { ContextPack } from "@/lib/draft-generation/context";
import type { InferenceRequest } from "@/lib/draft-generation/types";

/**
 * The locked prompt rules: write as the user, in the incoming language,
 * answer the latest mail, prior mail from the sender is relationship facts,
 * the user's sent mail is voice, no invented commitments, no quoted original,
 * body only. Tests assert facts (which mail is present), not wording.
 */

const SYSTEM_PROMPT = [
  "You draft email replies as the mailbox owner (\"the user\"). Follow every rule:",
  "- Write in the same language as the mail being answered.",
  "- Write a real reply that answers the latest mail, not a summary of it.",
  "- Treat earlier mail from the correspondent only as facts about the relationship.",
  "- Match the tone and voice of the user's own earlier mail.",
  "- Never invent facts, meetings, or commitments the user did not make.",
  "- Do not quote the original message back and do not add a subject line.",
  "- Return only the reply body as plain text; simple markdown is allowed.",
].join("\n");

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

export function buildInferenceRequest(pack: ContextPack): InferenceRequest {
  const parts: string[] = [];
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
  return { system: SYSTEM_PROMPT, user: parts.join("\n\n") };
}
