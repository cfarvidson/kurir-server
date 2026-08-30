import { z } from "zod";
import { DraftType } from "@prisma/client";
import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import {
  getDraftForUser,
  saveDraftForUser,
  type SaveDraftInput,
} from "@/lib/mail/drafts";
import { prepareDraftSave } from "@/lib/mail/draft-presentation-db";
import { getOwnAddresses } from "@/lib/mail/user-emails";
import {
  buildContextPack,
  firstToAddress,
  resolveReplyAddresses,
} from "@/lib/draft-generation/context";
import {
  loadDraftGenerationSecret,
  rotateDraftGenerationSecret,
} from "@/lib/draft-generation/credential";
import {
  buildInferenceRequest,
  parseGeneratedDraft,
} from "@/lib/draft-generation/prompt";
import { defaultInferenceAdapter } from "@/lib/draft-generation/providers";
import {
  buildMailboxTools,
  MAX_TOOL_CALLS,
} from "@/lib/draft-generation/tools";
import {
  DraftGenerationError,
  type InferenceAdapter,
} from "@/lib/draft-generation/types";

/**
 * Generate a draft body from the mail context. Shared verbatim by the web
 * server action and `/api/mobile/draft-generation/generate`.
 *
 * Two delivery modes, keyed on whether the request carries an `instruction`
 * field at all (kurir-server#133):
 *
 * - Field absent — an old client, or any one-tap caller. Exactly the old
 *   contract: the body is upserted as a normal Draft row through the
 *   existing saver, BODY_EXISTS guards typed text, no tools are offered.
 * - Field present (the compose assistant panel, even with an empty string) —
 *   the body comes back to the caller and the Draft row is not touched.
 *   Versions live in the open composer; inserting one goes through the
 *   composer's ordinary draft autosave. Bounded mailbox tools are offered,
 *   and NEW mail may come back with a proposed subject.
 *
 * New mail with an empty instruction and no prior correspondence with that
 * person is refused (NOTHING_TO_INFER) rather than inventing a mail.
 */

export const MAX_INSTRUCTION_CHARS = 2000;

export const generateDraftSchema = z.object({
  type: z.nativeEnum(DraftType),
  contextMessageId: z.string().min(1),
  to: z.string().optional(),
  replace: z.boolean().optional(),
  instruction: z.string().max(MAX_INSTRUCTION_CHARS).optional(),
  tone: z.enum(["auto", "formal", "friendly", "direct"]).optional(),
});

export type GenerateDraftInput = z.infer<typeof generateDraftSchema>;

/** What the caller gets back, per delivery mode. */
export type GenerateDraftResult =
  | { mode: "draft"; draft: Awaited<ReturnType<typeof saveDraftForUser>> }
  | { mode: "panel"; body: string; subject?: string };

const currentMessageSelect = {
  id: true,
  subject: true,
  fromAddress: true,
  fromName: true,
  replyTo: true,
  toAddresses: true,
  receivedAt: true,
  textBody: true,
  htmlBody: true,
} as const;

export async function generateDraftForUser(
  userId: string,
  input: GenerateDraftInput,
  infer: InferenceAdapter = defaultInferenceAdapter,
): Promise<GenerateDraftResult> {
  const isPanel = input.instruction !== undefined;
  const instructed = (input.instruction ?? "").trim() !== "";
  if (isDemoInstance()) {
    throw new DraftGenerationError(
      "DEMO_INSTANCE",
      "Draft generation is disabled on this demo instance.",
    );
  }
  if (input.type === "FORWARD") {
    throw new DraftGenerationError(
      "UNSUPPORTED_TYPE",
      "Draft generation is not available for forwards.",
    );
  }

  const credential = await loadDraftGenerationSecret(userId);
  if (!credential) {
    throw new DraftGenerationError(
      "NO_CREDENTIAL",
      "No draft-generation token is stored. Add one in Settings first.",
    );
  }

  const own = await getOwnAddresses(userId);

  let correspondent: string;
  let replyTo: string | null = null;
  let current: {
    id: string;
    subject: string | null;
    fromAddress: string;
    fromName: string | null;
    receivedAt: Date;
    textBody: string | null;
    htmlBody: string | null;
  } | null = null;

  if (input.type === "REPLY") {
    const message = await db.message.findFirst({
      where: { userId, id: input.contextMessageId },
      select: currentMessageSelect,
    });
    if (!message) {
      throw new DraftGenerationError(
        "CONTEXT_MESSAGE_MISSING",
        "The message being replied to no longer exists.",
      );
    }
    const resolved = resolveReplyAddresses(message, own);
    if (!resolved) {
      throw new DraftGenerationError(
        "NO_CORRESPONDENT",
        "Could not work out who this reply is to.",
      );
    }
    correspondent = resolved.correspondent;
    replyTo = resolved.to;
    current = message;
  } else {
    const to = firstToAddress(input.to);
    if (!to) {
      throw new DraftGenerationError(
        "NO_CORRESPONDENT",
        "Add a To address first.",
      );
    }
    correspondent = to;
  }

  // Panel mode never writes the Draft row, so there is nothing to conflict
  // with — the user inserts a version explicitly.
  const existing = isPanel
    ? null
    : await getDraftForUser(userId, input.type, input.contextMessageId);
  if (existing && existing.body.trim() !== "" && !input.replace) {
    throw new DraftGenerationError(
      "BODY_EXISTS",
      "This draft already has a body.",
    );
  }

  const pack = await buildContextPack(userId, correspondent, own, current);
  if (
    input.type === "NEW" &&
    !instructed &&
    pack.fromCorrespondent.length === 0 &&
    pack.ownSent.length === 0
  ) {
    throw new DraftGenerationError(
      "NOTHING_TO_INFER",
      "There is no earlier mail with this person. Say what this mail should say.",
    );
  }
  const raw = await infer({
    provider: credential.provider,
    secret: credential.secret,
    request: buildInferenceRequest(pack, {
      instruction: input.instruction,
      tone: input.tone,
      // A subject is only ever proposed for new mail; clients apply it only
      // when their subject field is empty.
      wantSubject: isPanel && input.type === "NEW",
      // Tools are the instructed path's ceiling. An empty instruction is the
      // one-tap flow reproduced, and must stay as fast and as narrow as it
      // was — seeded context pack only.
      tools: instructed ? buildMailboxTools(userId) : undefined,
      maxToolCalls: MAX_TOOL_CALLS,
    }),
    rotateSecret: (next) => rotateDraftGenerationSecret(userId, next),
  });

  if (isPanel) {
    const parsed = parseGeneratedDraft(raw);
    return {
      mode: "panel",
      body: parsed.body,
      ...(parsed.subject ? { subject: parsed.subject } : {}),
    };
  }

  // Generate fills the body; existing headers and attachments stay as they
  // were. A missing REPLY row gets its to/subject from the same reply-header
  // conventions the composer uses (Reply-To wins; subject via prepareDraftSave).
  const saveInput: SaveDraftInput = existing
    ? {
        type: input.type,
        contextMessageId: input.contextMessageId,
        to: existing.to,
        cc: existing.cc,
        bcc: existing.bcc,
        subject: existing.subject,
        emailConnectionId: existing.emailConnectionId ?? undefined,
        attachmentIds: existing.attachmentIds,
        body: raw,
      }
    : {
        type: input.type,
        contextMessageId: input.contextMessageId,
        to: input.type === "REPLY" ? (replyTo ?? "") : (input.to ?? ""),
        body: raw,
      };

  if (input.type === "REPLY") {
    const prepared = await prepareDraftSave(userId, saveInput);
    if (!prepared.ok) {
      throw new DraftGenerationError(
        "CONTEXT_MESSAGE_MISSING",
        "The message being replied to no longer exists.",
      );
    }
    return { mode: "draft", draft: await saveDraftForUser(userId, prepared.input) };
  }
  return { mode: "draft", draft: await saveDraftForUser(userId, saveInput) };
}
