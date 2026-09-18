/**
 * AI content rules: the database half. Rule CRUD scoped to the owning user,
 * and the evaluator that sends every not-yet-judged message from a rule's
 * senders to the user's draft-generation model, stores the verdict, and
 * files the message by the rule's actions.
 *
 * Evaluation runs detached after every completed sync and on demand from the
 * rules page (`kickContentRuleEvaluation`, the shared coalescing kicker).
 * Without a stored draft-generation credential it is a no-op: rules can be
 * written ahead of time and start judging once a token exists.
 */
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import type { ContentRuleAction, SubjectRuleScope } from "@prisma/client";
import {
  loadDraftGenerationSecret,
  rotateDraftGenerationSecret,
} from "@/lib/draft-generation/credential";
import { defaultInferenceAdapter } from "@/lib/draft-generation/providers";
import {
  DraftGenerationError,
  type InferenceAdapter,
} from "@/lib/draft-generation/types";
import { createUserKicker } from "@/lib/mail/kick-once";
import { emitToUser } from "@/lib/mail/sse-subscribers";
import {
  buildContentRuleRequest,
  contentRuleCoversSender,
  MAX_CRITERION_CHARS,
  normalizeScopeValue,
  parseContentRuleVerdict,
  placementForAction,
  rulesCoveringSender,
  senderScopeWhere,
} from "@/lib/mail/content-rules";

/** How far back "include mail that already arrived" reaches for a sender. */
export const LOOKBACK_DAYS = 30;
/**
 * Model calls per rule per run. A run that fills this reports `capped`, and
 * the detached kicker reruns until every rule drains.
 */
export const MAX_PER_RULE_PER_RUN = 20;

// A verdict only files mail the user has not acted on. Snoozed, reply-later
// and follow-up state is the user's own decision and always wins; deleted
// mail is never touched. Filing into a category additionally requires the
// message not to be archived (by the user, by a rejected sender, or by a
// subject rule), so a rule cannot resurrect archived mail.
const UNTOUCHED = {
  isDeleted: false,
  isSnoozed: false,
  isReplyLater: false,
  isFollowUp: false,
} as const;

export interface ContentRuleSenderInput {
  scope: SubjectRuleScope;
  scopeValue: string;
  /** Also judge this sender's mail from the last LOOKBACK_DAYS days. */
  includeExisting: boolean;
}

/** Earliest receivedAt a sender added now should be judged from. */
function sinceFor(includeExisting: boolean, now = new Date()): Date {
  return includeExisting
    ? new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    : now;
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
    select: { id: true, scope: true, scopeValue: true, since: true },
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
  const rules = await db.contentRule.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: ruleSelect,
  });
  // `_count.matches` is every verdict, hits and misses alike. The matched
  // half needs its own grouped count: Prisma cannot put the same relation
  // in `_count` twice under two filters.
  const matched = rules.length
    ? await db.contentRuleMatch.groupBy({
        by: ["ruleId"],
        where: { ruleId: { in: rules.map((rule) => rule.id) }, matched: true },
        _count: { _all: true },
      })
    : [];
  const matchedByRule = new Map(
    matched.map((row) => [row.ruleId, row._count._all]),
  );
  return rules.map((rule) => ({
    ...rule,
    matchedCount: matchedByRule.get(rule.id) ?? 0,
  }));
}

/** How many verdicts one page of judged mail carries at most. */
export const MAX_JUDGEMENTS_PER_PAGE = 100;

export interface ListContentRuleJudgementsOptions {
  limit?: number;
  /** Id of the last verdict on the previous page. */
  cursor?: string;
}

/**
 * One page of a rule's stored verdicts, newest first — misses included, so
 * the caller can show what the model looked at and how it ruled, not only
 * what it filed. Paged by verdict id.
 */
export async function listContentRuleJudgementsForUser(
  userId: string,
  ruleId: string,
  options: ListContentRuleJudgementsOptions = {},
) {
  await requireOwnedRule(userId, ruleId);
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? 50), 1),
    MAX_JUDGEMENTS_PER_PAGE,
  );
  const rows = await db.contentRuleMatch.findMany({
    where: { ruleId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      matched: true,
      reason: true,
      appliedAction: true,
      createdAt: true,
      message: {
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          fromName: true,
          receivedAt: true,
        },
      },
    },
  });
  const judgements = rows.slice(0, limit);
  const [judgedCount, matchedCount] = await Promise.all([
    db.contentRuleMatch.count({ where: { ruleId } }),
    db.contentRuleMatch.count({ where: { ruleId, matched: true } }),
  ]);
  return {
    judgements,
    judgedCount,
    matchedCount,
    nextCursor:
      rows.length > limit
        ? (judgements[judgements.length - 1]?.id ?? null)
        : null,
  };
}

/** How many of the user's rules judge mail from this address today. */
export async function countContentRulesCoveringSender(
  userId: string,
  senderEmail: string,
): Promise<number> {
  const rules = await db.contentRule.findMany({
    where: { userId },
    select: {
      senders: { select: { scope: true, scopeValue: true, since: true } },
    },
  });
  return rulesCoveringSender(senderEmail, rules).length;
}

function cleanCriterion(raw: string): string {
  const criterion = raw.trim();
  if (!criterion) throw new Error("Describe what the model should look for.");
  if (criterion.length > MAX_CRITERION_CHARS) {
    throw new Error(
      `Keep the criterion under ${MAX_CRITERION_CHARS} characters.`,
    );
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
  const scopeValue = normalizeScopeValue(
    input.sender.scope,
    input.sender.scopeValue,
  );
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
      senders: {
        create: {
          scope: input.sender.scope,
          scopeValue,
          since: sinceFor(input.sender.includeExisting),
        },
      },
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
  // Re-adding an existing sender keeps its original since; widening the
  // window would re-judge nothing anyway (verdicts are kept per message).
  await db.contentRuleSender.upsert({
    where: {
      ruleId_scope_scopeValue: { ruleId, scope: sender.scope, scopeValue },
    },
    update: {},
    create: {
      ruleId,
      scope: sender.scope,
      scopeValue,
      since: sinceFor(sender.includeExisting),
    },
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

export interface UpdateContentRuleInput {
  criterion?: string;
  onMatch?: ContentRuleAction;
  onNoMatch?: ContentRuleAction;
  /**
   * With a new criterion: forget every stored verdict so the rule judges its
   * senders' mail again under the new wording. Mail the rule archived stays
   * archived (a re-judgement never resurrects archived mail); the rest is
   * re-filed by the fresh verdict.
   */
  recheck?: boolean;
}

/** Whether the update should trigger a fresh evaluation run. */
export async function updateContentRuleForUser(
  userId: string,
  ruleId: string,
  data: UpdateContentRuleInput,
): Promise<{ rejudge: boolean }> {
  await requireOwnedRule(userId, ruleId);
  const rejudge = Boolean(data.recheck && data.criterion !== undefined);
  const update = db.contentRule.update({
    where: { id: ruleId },
    data: {
      ...(data.criterion !== undefined
        ? { criterion: cleanCriterion(data.criterion) }
        : {}),
      ...(data.onMatch ? { onMatch: data.onMatch } : {}),
      ...(data.onNoMatch ? { onNoMatch: data.onNoMatch } : {}),
    },
  });
  if (rejudge) {
    // Same transaction: a run that reads the new criterion also sees the
    // cleared verdicts, never the old verdicts under the new wording.
    await db.$transaction([
      db.contentRuleMatch.deleteMany({ where: { ruleId } }),
      update,
    ]);
  } else {
    await update;
  }
  return { rejudge };
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
  /** Messages a verdict actually re-filed. */
  refiled: number;
  /** Some rule still had candidates left after its per-run cap. */
  capped: boolean;
  skipped?: "NO_CREDENTIAL";
}

const candidateSelect = {
  id: true,
  uid: true,
  folderId: true,
  emailConnectionId: true,
  subject: true,
  fromAddress: true,
  fromName: true,
  receivedAt: true,
  textBody: true,
  htmlBody: true,
} as const;

/**
 * Judge every unjudged message from each rule's senders (bounded per rule
 * per run) and file it by the rule's actions. A dead or limited credential
 * (DraftGenerationError) stops the run and surfaces to the caller; any other
 * failure is confined to its rule so the remaining rules still run. Verdicts
 * stored so far stay stored.
 */
export async function evaluateContentRulesForUser(
  userId: string,
  infer: InferenceAdapter = defaultInferenceAdapter,
): Promise<ContentRuleRunResult> {
  const credential = await loadDraftGenerationSecret(userId);
  if (!credential) {
    return {
      evaluated: 0,
      matched: 0,
      refiled: 0,
      capped: false,
      skipped: "NO_CREDENTIAL",
    };
  }

  const rules = await db.contentRule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      criterion: true,
      onMatch: true,
      onNoMatch: true,
      emailConnectionId: true,
      updatedAt: true,
      senders: { select: { scope: true, scopeValue: true, since: true } },
    },
  });

  const result: ContentRuleRunResult = {
    evaluated: 0,
    matched: 0,
    refiled: 0,
    capped: false,
  };
  for (const rule of rules) {
    if (rule.senders.length === 0) continue;
    try {
      await evaluateRule(userId, credential, rule, infer, result);
    } catch (err) {
      // Credential trouble affects every rule: stop and let the caller see it.
      if (err instanceof DraftGenerationError) throw err;
      console.error(
        `[content-rules] rule ${rule.id} failed for ${userId}`,
        err,
      );
    }
  }
  if (result.refiled > 0) {
    // Sidebar counts are cached; a detached run has no request to piggyback
    // on, so invalidate here (and tolerate a context that cannot).
    try {
      revalidateTag("sidebar-counts", { expire: 0 });
    } catch (err) {
      console.warn("[content-rules] sidebar-counts revalidation skipped", err);
    }
  }
  return result;
}

type RuleForRun = {
  id: string;
  criterion: string;
  onMatch: ContentRuleAction;
  onNoMatch: ContentRuleAction;
  emailConnectionId: string | null;
  updatedAt: Date;
  senders: { scope: SubjectRuleScope; scopeValue: string; since: Date }[];
};

async function evaluateRule(
  userId: string,
  credential: { provider: "claudeCode" | "grokBuild"; secret: string },
  rule: RuleForRun,
  infer: InferenceAdapter,
  result: ContentRuleRunResult,
): Promise<void> {
  const candidates = await db.message.findMany({
    where: {
      userId,
      ...(rule.emailConnectionId
        ? { emailConnectionId: rule.emailConnectionId }
        : {}),
      folder: { specialUse: "inbox" },
      isDeleted: false,
      contentRuleMatches: { none: { ruleId: rule.id } },
      // Each sender carries its own since, so the window lives in the clauses.
      OR: senderScopeWhere(rule.senders),
    },
    orderBy: { receivedAt: "desc" },
    take: MAX_PER_RULE_PER_RUN,
    select: candidateSelect,
  });
  if (candidates.length === MAX_PER_RULE_PER_RUN) result.capped = true;

  // IMAP moves for rule archives, one round-trip per inbox folder.
  const toArchive = new Map<
    string,
    { emailConnectionId: string; uids: number[] }
  >();

  for (const message of candidates) {
    if (
      !contentRuleCoversSender(
        message.fromAddress,
        message.receivedAt,
        rule.senders,
      )
    )
      continue;
    const raw = await infer({
      provider: credential.provider,
      secret: credential.secret,
      request: buildContentRuleRequest(rule.criterion, message),
      rotateSecret: (next) => rotateDraftGenerationSecret(userId, next),
    });
    const verdict = parseContentRuleVerdict(raw);
    if (!verdict) {
      // Nothing stored: the message stays eligible and is retried next run.
      console.warn(
        `[content-rules] unreadable verdict for ${message.id} under ${rule.id}`,
      );
      continue;
    }

    // The rule may have been edited or deleted while the model was busy;
    // a verdict for a stale rule is discarded and the message re-judged.
    const current = await db.contentRule.findUnique({
      where: { id: rule.id },
      select: { updatedAt: true },
    });
    if (!current) return;
    if (current.updatedAt.getTime() !== rule.updatedAt.getTime()) return;

    const appliedAction = verdict.matched ? rule.onMatch : rule.onNoMatch;
    await db.contentRuleMatch.upsert({
      where: { ruleId_messageId: { ruleId: rule.id, messageId: message.id } },
      update: {
        matched: verdict.matched,
        reason: verdict.reason,
        appliedAction,
      },
      create: {
        ruleId: rule.id,
        messageId: message.id,
        matched: verdict.matched,
        reason: verdict.reason,
        appliedAction,
      },
    });
    result.evaluated++;
    if (verdict.matched) result.matched++;

    const placement = placementForAction(appliedAction);
    if (!placement) continue;
    // Conditional write: the message must still be untouched at write time,
    // so a verdict that lands after the user archived or snoozed it is a no-op.
    const written = await db.message.updateMany({
      where: {
        id: message.id,
        ...UNTOUCHED,
        ...(placement.isArchived ? {} : { isArchived: false }),
      },
      data: placement,
    });
    if (written.count === 0) continue;
    result.refiled++;
    emitToUser(userId, {
      type: "flags-changed",
      data: { messageId: message.id, flags: { ...placement } },
    });
    if (placement.isArchived) {
      const bucket = toArchive.get(message.folderId) ?? {
        emailConnectionId: message.emailConnectionId,
        uids: [],
      };
      bucket.uids.push(message.uid);
      toArchive.set(message.folderId, bucket);
    }
  }

  // Mirror the Archive button: the DB is authoritative, the IMAP move
  // follows and a broken connection never fails the run. Loaded lazily so
  // the IDLE path (which imports this module) stays free of the IMAP stack.
  if (toArchive.size === 0) return;
  const { moveToArchiveViaImap } = await import("@/lib/mail/archive-imap");
  for (const [folderId, { emailConnectionId, uids }] of toArchive) {
    try {
      await moveToArchiveViaImap(userId, emailConnectionId, folderId, uids);
    } catch (err) {
      console.error(
        `[content-rules] IMAP archive move failed for ${userId}`,
        err,
      );
    }
  }
}

const kicker = createUserKicker("content-rules", async (userId) => {
  const result = await evaluateContentRulesForUser(userId);
  if (result.evaluated > 0) {
    console.log(
      `[content-rules] judged ${result.evaluated} messages (${result.matched} matched, ${result.refiled} re-filed) for ${userId}`,
    );
  }
  return result.capped;
});

/**
 * Detached evaluation after a sync or from the rules page: returns at once,
 * never throws, runs one evaluation per user at a time and keeps going while
 * a rule still has more than one bounded pass of mail to judge.
 */
export function kickContentRuleEvaluation(userId: string): void {
  kicker.kick(userId);
}

/** Test hook: forget in-flight state. */
export function resetContentRuleKicks(): void {
  kicker.reset();
}
