/**
 * AI content rules: the database half. Rule CRUD scoped to the owning user,
 * and the evaluator that sends every not-yet-judged message from a rule's
 * senders to the user's draft-generation model, stores the verdict, and
 * files the message by the rule's actions.
 *
 * Evaluation runs detached after a sync (`kickContentRuleEvaluation`, the
 * same running/queued shape as the Rank recompute) and on demand from the
 * rules page. Without a stored draft-generation credential it is a no-op:
 * rules can be written ahead of time and start judging once a token exists.
 */
import { db } from "@/lib/db";
import type { ContentRuleAction, SubjectRuleScope } from "@prisma/client";
import { loadDraftGenerationSecret, rotateDraftGenerationSecret } from "@/lib/draft-generation/credential";
import { defaultInferenceAdapter } from "@/lib/draft-generation/providers";
import type { InferenceAdapter } from "@/lib/draft-generation/types";
import {
  buildContentRuleRequest,
  contentRuleCoversSender,
  MAX_CRITERION_CHARS,
  normalizeScopeValue,
  parseContentRuleVerdict,
  placementForAction,
  senderScopeWhere,
} from "@/lib/mail/content-rules";

/** How far back a new rule looks for mail to judge. */
const LOOKBACK_DAYS = 30;
/** Model calls per rule per run; the next sync picks up the rest. */
const MAX_PER_RULE_PER_RUN = 20;
const UNREADABLE_REASON = "The model's answer could not be read.";

export interface ContentRuleSenderInput {
  scope: SubjectRuleScope;
  scopeValue: string;
}

export interface CreateContentRuleInput {
  criterion: string;
  onMatch: ContentRuleAction;
  onNoMatch: ContentRuleAction;
  emailConnectionId?: string | null;
  sender: ContentRuleSenderInput;
}

const ruleSelect = {
  id: true,
  criterion: true,
  onMatch: true,
  onNoMatch: true,
  emailConnectionId: true,
  createdAt: true,
  senders: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true, scope: true, scopeValue: true },
  },
  _count: { select: { matches: true } },
  matches: {
    where: { matched: true },
    orderBy: { createdAt: "desc" as const },
    take: 20,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      message: {
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          fromName: true,
          receivedAt: true,
          isArchived: true,
          isInFeed: true,
          isInPaperTrail: true,
        },
      },
    },
  },
} as const;

export type ContentRuleListItem = Awaited<
  ReturnType<typeof listContentRulesForUser>
>[number];

export async function listContentRulesForUser(userId: string) {
  return db.contentRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: ruleSelect,
  });
}

function cleanCriterion(raw: string): string {
  const criterion = raw.trim();
  if (!criterion) throw new Error("Describe what the model should look for.");
  if (criterion.length > MAX_CRITERION_CHARS) {
    throw new Error(`Keep the criterion under ${MAX_CRITERION_CHARS} characters.`);
  }
  return criterion;
}

async function requireOwnedRule(userId: string, ruleId: string) {
  const rule = await db.contentRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule || rule.userId !== userId) throw new Error("Rule not found");
  return rule;
}

export async function createContentRuleForUser(
  userId: string,
  input: CreateContentRuleInput,
) {
  const criterion = cleanCriterion(input.criterion);
  const scopeValue = normalizeScopeValue(input.sender.scope, input.sender.scopeValue);
  const emailConnectionId = input.emailConnectionId || null;
  if (emailConnectionId) {
    const connection = await db.emailConnection.findUnique({
      where: { id: emailConnectionId },
      select: { userId: true },
    });
    if (!connection || connection.userId !== userId) {
      throw new Error("Inbox not found");
    }
  }
  return db.contentRule.create({
    data: {
      userId,
      criterion,
      onMatch: input.onMatch,
      onNoMatch: input.onNoMatch,
      emailConnectionId,
      senders: { create: { scope: input.sender.scope, scopeValue } },
    },
    select: { id: true },
  });
}

export async function addContentRuleSenderForUser(
  userId: string,
  ruleId: string,
  sender: ContentRuleSenderInput,
) {
  await requireOwnedRule(userId, ruleId);
  const scopeValue = normalizeScopeValue(sender.scope, sender.scopeValue);
  await db.contentRuleSender.upsert({
    where: { ruleId_scope_scopeValue: { ruleId, scope: sender.scope, scopeValue } },
    update: {},
    create: { ruleId, scope: sender.scope, scopeValue },
  });
}

export async function removeContentRuleSenderForUser(
  userId: string,
  senderRowId: string,
) {
  const row = await db.contentRuleSender.findUnique({
    where: { id: senderRowId },
    select: { id: true, rule: { select: { userId: true } } },
  });
  if (!row || row.rule.userId !== userId) throw new Error("Sender not found");
  await db.contentRuleSender.delete({ where: { id: senderRowId } });
}

export async function updateContentRuleForUser(
  userId: string,
  ruleId: string,
  data: { criterion?: string; onMatch?: ContentRuleAction; onNoMatch?: ContentRuleAction },
) {
  await requireOwnedRule(userId, ruleId);
  await db.contentRule.update({
    where: { id: ruleId },
    data: {
      ...(data.criterion !== undefined ? { criterion: cleanCriterion(data.criterion) } : {}),
      ...(data.onMatch ? { onMatch: data.onMatch } : {}),
      ...(data.onNoMatch ? { onNoMatch: data.onNoMatch } : {}),
    },
  });
}

/** Delete a rule. Placements it made are materialized and stay. */
export async function deleteContentRuleForUser(userId: string, ruleId: string) {
  const rule = await db.contentRule.findUnique({
    where: { id: ruleId },
    select: { id: true, userId: true },
  });
  if (!rule) return;
  if (rule.userId !== userId) throw new Error("Rule not found");
  await db.contentRule.delete({ where: { id: ruleId } });
}

export interface ContentRuleRunResult {
  evaluated: number;
  matched: number;
  skipped?: "NO_CREDENTIAL";
}

/**
 * Judge every unjudged message from each rule's senders (bounded per rule
 * per run) and file it by the rule's actions. A model failure stops the run
 * and surfaces to the caller; verdicts stored so far stay stored.
 */
export async function evaluateContentRulesForUser(
  userId: string,
  infer: InferenceAdapter = defaultInferenceAdapter,
): Promise<ContentRuleRunResult> {
  const credential = await loadDraftGenerationSecret(userId);
  if (!credential) return { evaluated: 0, matched: 0, skipped: "NO_CREDENTIAL" };

  const rules = await db.contentRule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      criterion: true,
      onMatch: true,
      onNoMatch: true,
      emailConnectionId: true,
      createdAt: true,
      senders: { select: { scope: true, scopeValue: true } },
    },
  });

  let evaluated = 0;
  let matched = 0;
  for (const rule of rules) {
    if (rule.senders.length === 0) continue;
    const since = new Date(rule.createdAt.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await db.message.findMany({
      where: {
        userId,
        ...(rule.emailConnectionId ? { emailConnectionId: rule.emailConnectionId } : {}),
        folder: { specialUse: "inbox" },
        receivedAt: { gte: since },
        contentRuleMatches: { none: { ruleId: rule.id } },
        OR: senderScopeWhere(rule.senders),
      },
      orderBy: { receivedAt: "desc" },
      take: MAX_PER_RULE_PER_RUN,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        fromName: true,
        receivedAt: true,
        textBody: true,
        htmlBody: true,
      },
    });

    for (const message of candidates) {
      if (!contentRuleCoversSender(message.fromAddress, rule.senders)) continue;
      const raw = await infer({
        provider: credential.provider,
        secret: credential.secret,
        request: buildContentRuleRequest(rule.criterion, message),
        rotateSecret: (next) => rotateDraftGenerationSecret(userId, next),
      });
      const verdict = parseContentRuleVerdict(raw);
      const stored = verdict ?? { matched: false, reason: UNREADABLE_REASON };
      await db.contentRuleMatch.upsert({
        where: { ruleId_messageId: { ruleId: rule.id, messageId: message.id } },
        update: { matched: stored.matched, reason: stored.reason },
        create: {
          ruleId: rule.id,
          messageId: message.id,
          matched: stored.matched,
          reason: stored.reason,
        },
      });
      evaluated++;
      if (!verdict) continue;
      if (verdict.matched) matched++;
      const placement = placementForAction(verdict.matched ? rule.onMatch : rule.onNoMatch);
      if (placement) {
        await db.message.update({ where: { id: message.id }, data: placement });
      }
    }
  }
  return { evaluated, matched };
}

const running = new Set<string>();
const queued = new Set<string>();

/**
 * Detached evaluation after a sync: returns at once, never throws, runs one
 * evaluation per user at a time and once more if kicked mid-run.
 */
export function kickContentRuleEvaluation(userId: string): void {
  if (running.has(userId)) {
    queued.add(userId);
    return;
  }
  running.add(userId);
  void (async () => {
    try {
      do {
        queued.delete(userId);
        try {
          const result = await evaluateContentRulesForUser(userId);
          if (result.evaluated > 0) {
            console.log(
              `[content-rules] judged ${result.evaluated} messages (${result.matched} matched) for ${userId}`,
            );
          }
        } catch (err) {
          console.error(`[content-rules] evaluation failed for ${userId}`, err);
        }
      } while (queued.has(userId));
    } finally {
      running.delete(userId);
    }
  })();
}

/** Test hook: forget in-flight state. */
export function resetContentRuleKicks(): void {
  running.clear();
  queued.clear();
}
