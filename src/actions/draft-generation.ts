"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  getDraftGenerationStatus,
  removeDraftGenerationCredential,
  saveDraftGenerationCredential,
} from "@/lib/draft-generation/credential";
import {
  generateDraftForUser,
  type GenerateDraftInput,
} from "@/lib/draft-generation/generate";
import {
  DraftGenerationError,
  type DraftGenerationErrorCode,
  type DraftGenerationProvider,
  type DraftGenerationStatus,
} from "@/lib/draft-generation/types";
import { rateLimitDraftGeneration } from "@/lib/rate-limit";

/**
 * Web wrappers for the draft-generation module. The mobile routes wrap the
 * same functions, so classification, context packing, and the Draft upsert
 * cannot drift between surfaces. Errors come back as `{ ok: false, code }`
 * (not throws) so the client can branch on them — BODY_EXISTS drives the
 * confirm-before-replace flow.
 */

export type DraftGenerationActionError = {
  ok: false;
  code: DraftGenerationErrorCode | "RATE_LIMITED";
  error: string;
};

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getDraftGenerationSettings(): Promise<DraftGenerationStatus> {
  const userId = await requireUserId();
  return getDraftGenerationStatus(userId);
}

export async function saveDraftGenerationToken(
  provider: DraftGenerationProvider,
  token: string,
): Promise<{ ok: true; status: DraftGenerationStatus } | DraftGenerationActionError> {
  const userId = await requireUserId();
  try {
    const status = await saveDraftGenerationCredential(userId, provider, token);
    revalidatePath("/settings");
    return { ok: true, status };
  } catch (error) {
    if (error instanceof DraftGenerationError) {
      return { ok: false, code: error.code, error: error.message };
    }
    throw error;
  }
}

export async function removeDraftGenerationToken(): Promise<DraftGenerationStatus> {
  const userId = await requireUserId();
  const status = await removeDraftGenerationCredential(userId);
  revalidatePath("/settings");
  return status;
}

/**
 * Panel mode (an `instruction` field on the request) answers with the body
 * itself and leaves the Draft row alone; the composer owns the versions.
 * One-tap keeps answering with the upserted draft.
 */
export type GenerateDraftActionResult =
  | {
      ok: true;
      draft: {
        type: string;
        contextMessageId: string;
        to: string;
        cc: string;
        bcc: string;
        subject: string;
        body: string;
      };
    }
  | { ok: true; body: string; subject?: string }
  | DraftGenerationActionError;

export async function generateDraft(
  input: GenerateDraftInput,
): Promise<GenerateDraftActionResult> {
  const userId = await requireUserId();
  const limit = await rateLimitDraftGeneration(userId);
  if (!limit.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      error: "Too many generations. Try again in a moment.",
    };
  }
  try {
    const result = await generateDraftForUser(userId, input);
    if (result.mode === "panel") {
      return {
        ok: true,
        body: result.body,
        ...(result.subject ? { subject: result.subject } : {}),
      };
    }
    const { draft } = result;
    return {
      ok: true,
      draft: {
        type: draft.type,
        contextMessageId: draft.contextMessageId,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
      },
    };
  } catch (error) {
    if (error instanceof DraftGenerationError) {
      return { ok: false, code: error.code, error: error.message };
    }
    throw error;
  }
}
