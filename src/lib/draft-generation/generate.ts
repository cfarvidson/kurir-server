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
import { buildInferenceRequest } from "@/lib/draft-generation/prompt";
import { defaultInferenceAdapter } from "@/lib/draft-generation/providers";
import {
  DraftGenerationError,
  type InferenceAdapter,
} from "@/lib/draft-generation/types";

/**
 * Generate a draft body and upsert it as a normal Draft row through the
 * existing saver, so it shows up in Drafts on web, iPhone, and Mac. Shared
 * verbatim by the web server action and `/api/mobile/draft-generation/generate`.
 */

export const generateDraftSchema = z.object({
  type: z.nativeEnum(DraftType),
  contextMessageId: z.string().min(1),
  to: z.string().optional(),
  replace: z.boolean().optional(),
});

export type GenerateDraftInput = z.infer<typeof generateDraftSchema>;

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
) {
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

  const existing = await getDraftForUser(
    userId,
    input.type,
    input.contextMessageId,
  );
  if (existing && existing.body.trim() !== "" && !input.replace) {
    throw new DraftGenerationError(
      "BODY_EXISTS",
      "This draft already has a body.",
    );
  }

  const pack = await buildContextPack(userId, correspondent, own, current);
  const body = await infer({
    provider: credential.provider,
    secret: credential.secret,
    request: buildInferenceRequest(pack),
    rotateSecret: (next) => rotateDraftGenerationSecret(userId, next),
  });

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
        body,
      }
    : {
        type: input.type,
        contextMessageId: input.contextMessageId,
        to: input.type === "REPLY" ? (replyTo ?? "") : (input.to ?? ""),
        body,
      };

  if (input.type === "REPLY") {
    const prepared = await prepareDraftSave(userId, saveInput);
    if (!prepared.ok) {
      throw new DraftGenerationError(
        "CONTEXT_MESSAGE_MISSING",
        "The message being replied to no longer exists.",
      );
    }
    return saveDraftForUser(userId, prepared.input);
  }
  return saveDraftForUser(userId, saveInput);
}
