"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/lib/auth";
import type { ContentRuleAction, SubjectRuleScope } from "@prisma/client";
import {
  addContentRuleSenderForUser,
  createContentRuleForUser,
  deleteContentRuleForUser,
  evaluateContentRulesForUser,
  kickContentRuleEvaluation,
  removeContentRuleSenderForUser,
  updateContentRuleForUser,
  type ContentRuleRunResult,
} from "@/lib/mail/content-rule-store";
import { DraftGenerationError } from "@/lib/draft-generation/types";

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

// Rule actions re-file messages, so every category surface may change.
function revalidateMailSurfaces() {
  updateTag("sidebar-counts");
  revalidatePath("/filters");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
}

function failure(err: unknown, fallback: string): ActionResult {
  const message = err instanceof Error ? err.message : fallback;
  return { ok: false, error: message || fallback };
}

export async function createContentRule(input: {
  criterion: string;
  onMatch: ContentRuleAction;
  onNoMatch: ContentRuleAction;
  emailConnectionId?: string | null;
  sender: { scope: SubjectRuleScope; scopeValue: string };
}): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await createContentRuleForUser(userId, input);
  } catch (err) {
    return failure(err, "Could not create the rule.");
  }
  // Judge the sender's recent mail right away rather than at the next sync.
  kickContentRuleEvaluation(userId);
  revalidatePath("/filters");
  return { ok: true };
}

export async function addContentRuleSender(
  ruleId: string,
  sender: { scope: SubjectRuleScope; scopeValue: string },
): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await addContentRuleSenderForUser(userId, ruleId, sender);
  } catch (err) {
    return failure(err, "Could not add the sender.");
  }
  kickContentRuleEvaluation(userId);
  revalidatePath("/filters");
  return { ok: true };
}

export async function removeContentRuleSender(
  senderRowId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await removeContentRuleSenderForUser(userId, senderRowId);
  } catch (err) {
    return failure(err, "Could not remove the sender.");
  }
  revalidatePath("/filters");
  return { ok: true };
}

export async function updateContentRule(
  ruleId: string,
  data: { criterion?: string; onMatch?: ContentRuleAction; onNoMatch?: ContentRuleAction },
): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await updateContentRuleForUser(userId, ruleId, data);
  } catch (err) {
    return failure(err, "Could not save the rule.");
  }
  revalidatePath("/filters");
  return { ok: true };
}

export async function deleteContentRule(ruleId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await deleteContentRuleForUser(userId, ruleId);
  } catch (err) {
    return failure(err, "Could not delete the rule.");
  }
  revalidatePath("/filters");
  return { ok: true };
}

/** Judge unjudged mail now, in the request, so the page can report it. */
export async function runContentRules(): Promise<
  ({ ok: true } & ContentRuleRunResult) | { ok: false; error: string }
> {
  const userId = await requireUserId();
  let result: ContentRuleRunResult;
  try {
    result = await evaluateContentRulesForUser(userId);
  } catch (err) {
    if (err instanceof DraftGenerationError) {
      return { ok: false, error: err.message };
    }
    console.error("[content-rules] manual run failed", err);
    return { ok: false, error: "The model could not be reached. Try again." };
  }
  revalidateMailSurfaces();
  return { ok: true, ...result };
}
