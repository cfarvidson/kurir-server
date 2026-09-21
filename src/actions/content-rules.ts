"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { ContentRuleAction } from "@prisma/client";
import {
  addContentRuleSenderForUser,
  createContentRuleForUser,
  deleteContentRuleForUser,
  kickContentRuleEvaluation,
  listContentRulesForUser,
  recheckContentRuleForUser,
  removeContentRuleSenderForUser,
  updateContentRuleForUser,
  type ContentRuleSenderInput,
  type UpdateContentRuleInput,
} from "@/lib/mail/content-rule-store";
import { rateLimitContentRules } from "@/lib/rate-limit";

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
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
  sender: ContentRuleSenderInput;
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

/** The rules the "AI rule" menu offers to add a sender to. */
export async function listContentRulesForPicker(): Promise<
  {
    id: string;
    criterion: string;
    senders: { scope: ContentRuleSenderInput["scope"]; scopeValue: string }[];
  }[]
> {
  const userId = await requireUserId();
  const rules = await listContentRulesForUser(userId);
  return rules.map((rule) => ({
    id: rule.id,
    criterion: rule.criterion,
    senders: rule.senders.map((s) => ({
      scope: s.scope,
      scopeValue: s.scopeValue,
    })),
  }));
}

export async function addContentRuleSender(
  ruleId: string,
  sender: ContentRuleSenderInput,
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
  data: UpdateContentRuleInput,
): Promise<ActionResult> {
  const userId = await requireUserId();
  let rejudge = false;
  try {
    ({ rejudge } = await updateContentRuleForUser(userId, ruleId, data));
  } catch (err) {
    return failure(err, "Could not save the rule.");
  }
  if (rejudge) kickContentRuleEvaluation(userId);
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

/** Judge the rule's mail from the last 30 days again, rate limited like Check now. */
export async function recheckContentRule(
  ruleId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const limit = await rateLimitContentRules(userId);
  if (!limit.allowed) {
    return { ok: false, error: "Too many checks. Try again in a few minutes." };
  }
  try {
    await recheckContentRuleForUser(userId, ruleId);
  } catch (err) {
    return failure(err, "Could not re-check the rule.");
  }
  kickContentRuleEvaluation(userId);
  revalidatePath("/filters");
  return { ok: true };
}

/**
 * Judge unjudged mail now. The run is detached and coalesced with any
 * sync-triggered run, so this never holds the request open or doubles
 * model calls; the page shows the verdicts on its next load.
 */
export async function runContentRules(): Promise<ActionResult> {
  const userId = await requireUserId();
  const limit = await rateLimitContentRules(userId);
  if (!limit.allowed) {
    return { ok: false, error: "Too many checks. Try again in a few minutes." };
  }
  kickContentRuleEvaluation(userId);
  revalidatePath("/filters");
  return { ok: true };
}
