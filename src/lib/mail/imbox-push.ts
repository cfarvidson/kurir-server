/**
 * Push notifications for newly ingested Imbox mail. Mail that an AI content
 * rule will judge is held until the evaluation run covering it has finished,
 * then pushed only if it is still in the Imbox, so a rule that files it away
 * never buzzes the phone first. Everything else pushes at once.
 *
 * The hold fails open: a run that ends without judging the message (no
 * credential, model failure, unreadable verdict) still releases the push.
 */
import { db } from "@/lib/db";
import { contentRuleCoversSender } from "@/lib/mail/content-rules";
import { pushToUser } from "@/lib/mail/push-sender";
import type { ImboxPushMessage } from "@/lib/mail/push-select";

/** Message ids per user whose push waits for the next evaluation run. */
const held = new Map<string, Set<string>>();

function send(userId: string, m: ImboxPushMessage): void {
  pushToUser(userId, {
    title: m.fromName || m.fromAddress,
    body: m.subject || "(no subject)",
    url: `/imbox/${m.id}`,
    tag: m.threadId || m.id,
  }).catch((err) => console.error("[push] error:", err));
}

/** Ids among `messages` that one of the user's AI rules will judge. */
async function idsAwaitingVerdict(
  userId: string,
  messages: ImboxPushMessage[],
): Promise<Set<string>> {
  const rules = await db.contentRule.findMany({
    where: { userId, senders: { some: {} } },
    select: {
      emailConnectionId: true,
      senders: { select: { scope: true, scopeValue: true, since: true } },
    },
  });
  if (rules.length === 0) return new Set();

  const rows = await db.message.findMany({
    where: { id: { in: messages.map((m) => m.id) } },
    select: {
      id: true,
      fromAddress: true,
      receivedAt: true,
      emailConnectionId: true,
    },
  });
  return new Set(
    rows
      .filter((row) =>
        rules.some(
          (rule) =>
            (!rule.emailConnectionId ||
              rule.emailConnectionId === row.emailConnectionId) &&
            contentRuleCoversSender(
              row.fromAddress,
              row.receivedAt,
              rule.senders,
            ),
        ),
      )
      .map((row) => row.id),
  );
}

/**
 * Notify about new Imbox messages (already deduped per thread). Never throws:
 * if the rule lookup fails, every message pushes at once as before.
 */
export async function pushNewImboxMessages(
  userId: string,
  messages: ImboxPushMessage[],
): Promise<void> {
  if (messages.length === 0) return;

  let awaiting = new Set<string>();
  try {
    awaiting = await idsAwaitingVerdict(userId, messages);
  } catch (err) {
    console.error("[push] AI rule lookup failed, pushing at once:", err);
  }

  for (const m of messages) {
    if (!awaiting.has(m.id)) send(userId, m);
  }
  if (awaiting.size === 0) return;

  console.log(
    `[push] Holding ${awaiting.size} notification(s) for ${userId} until AI rules have judged them`,
  );
  const ids = held.get(userId) ?? new Set<string>();
  for (const id of awaiting) ids.add(id);
  held.set(userId, ids);
  // Kick after holding: either this starts a run that takes the ids, or a
  // run is in flight and the queued rerun takes them.
  const { kickContentRuleEvaluation } = await import("./content-rule-store");
  kickContentRuleEvaluation(userId);
}

/**
 * Held ids for an evaluation run that is about to start. The run hands them
 * to `releaseHeldPushes` when it ends; ids held after this call wait for the
 * next run.
 */
export function takeHeldPushes(userId: string): string[] {
  const ids = [...(held.get(userId) ?? [])];
  held.delete(userId);
  return ids;
}

/** Push the held messages that are still in the Imbox after the run. */
export async function releaseHeldPushes(
  userId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.message.findMany({
    where: {
      id: { in: ids },
      isInImbox: true,
      isArchived: false,
      isDeleted: false,
    },
    select: {
      id: true,
      fromName: true,
      fromAddress: true,
      subject: true,
      threadId: true,
    },
  });
  for (const m of rows) send(userId, m);
}

/** Test hook: forget held pushes. */
export function resetHeldPushes(): void {
  held.clear();
}
