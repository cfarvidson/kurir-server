import { db } from "@/lib/db";

/**
 * Shared thread-assignment for every path that writes a message row: IMAP
 * ingest and all three send paths (immediate send, scheduled send, scheduled
 * send-now). Keeping one implementation is the point — the send paths used to
 * carry diverging copies with no root fallback and no unify pass, so an
 * app-composed mail could sit with threadId = null (or a reply could get a
 * thread key its anchor never joined) until ingest happened to repair it.
 */

/** Message-IDs this message claims a relationship to (references + inReplyTo). */
export function relatedMessageIds(
  inReplyTo: string | null,
  references: string[],
): string[] {
  const related = [...references];
  if (inReplyTo && !related.includes(inReplyTo)) {
    related.push(inReplyTo);
  }
  return related;
}

/**
 * Resolve the threadId for a message about to be persisted:
 * 1. a known related message that already has a threadId → reuse it
 * 2. otherwise the conversation root's Message-ID (references[0] || inReplyTo);
 *    the unify pass back-fills the anchor row so both end up grouped even when
 *    the anchor's threadId is still null
 * 3. otherwise (no relations at all) the message's own Message-ID, so a fresh
 *    conversation gets a non-null thread key at write time
 */
export async function resolveThreadId(opts: {
  userId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}): Promise<string | null> {
  const related = relatedMessageIds(opts.inReplyTo, opts.references);

  let threadId: string | null = null;
  if (related.length > 0) {
    const existingThreadMsg = await db.message.findFirst({
      where: {
        userId: opts.userId,
        OR: [{ messageId: { in: related } }, { threadId: { in: related } }],
        threadId: { not: null },
      },
      select: { threadId: true },
    });
    threadId =
      existingThreadMsg?.threadId || opts.references[0] || opts.inReplyTo;
  }

  return threadId || opts.messageId || null;
}

/**
 * Back-fill the resolved threadId across every known message in the same
 * conversation (rows the new message references, and rows that reply to those)
 * so divergent or null threadIds converge on one key.
 */
export async function unifyThreadId(
  userId: string,
  threadId: string | null,
  related: string[],
): Promise<void> {
  if (!threadId || related.length === 0) return;
  await db.message.updateMany({
    where: {
      userId,
      OR: [{ messageId: { in: related } }, { inReplyTo: { in: related } }],
      NOT: { threadId },
    },
    data: { threadId },
  });
}

/** Resolve + unify in one step. Every message write path goes through this. */
export async function assignThreadId(opts: {
  userId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}): Promise<string | null> {
  const threadId = await resolveThreadId(opts);
  await unifyThreadId(
    opts.userId,
    threadId,
    relatedMessageIds(opts.inReplyTo, opts.references),
  );
  return threadId;
}

/**
 * Walk reply chains to unify threadIds across entire conversations.
 *
 * A parent link resolves through inReplyTo first, then through references
 * (the RFC orders them oldest → newest, so the walk scans from the end to
 * let the nearest known ancestor win). When the
 * topmost reachable message still references mail we do not have — common on
 * boxes that only sync INBOX/Sent/Archive — its already-assigned threadId is
 * the thread key, and a subtree whose key is unknown is left untouched rather
 * than reset to its own Message-ID (which used to move correctly threaded
 * replies out of their thread).
 */
export async function repairThreadIds(userId: string): Promise<void> {
  const messages = await db.message.findMany({
    where: { userId },
    select: {
      id: true,
      messageId: true,
      threadId: true,
      inReplyTo: true,
      references: true,
    },
  });

  const byMessageId = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (m.messageId) byMessageId.set(m.messageId, m);
  }

  function knownParentId(msg: (typeof messages)[number]): string | null {
    if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) return msg.inReplyTo;
    for (let i = msg.references.length - 1; i >= 0; i--) {
      const ref = msg.references[i];
      if (ref !== msg.messageId && byMessageId.has(ref)) return ref;
    }
    return null;
  }

  function findThreadKey(msg: (typeof messages)[number]): string | null {
    const visited = new Set<string>();
    let current = msg;
    for (;;) {
      const parentId = knownParentId(current);
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);
      current = byMessageId.get(parentId)!;
    }
    if (current.inReplyTo || current.references.length > 0) {
      // The chain's top still points at messages missing from the DB: its
      // assigned threadId (often one of those missing ids) is the best key we
      // have. Null means we know nothing better — skip instead of resetting.
      return current.threadId;
    }
    return current.messageId;
  }

  const fixes: { id: string; threadId: string }[] = [];
  for (const msg of messages) {
    const threadKey = findThreadKey(msg);
    if (threadKey && msg.threadId !== threadKey) {
      fixes.push({ id: msg.id, threadId: threadKey });
    }
  }

  if (fixes.length > 0) {
    const byThreadId = new Map<string, string[]>();
    for (const { id, threadId } of fixes) {
      if (!byThreadId.has(threadId)) byThreadId.set(threadId, []);
      byThreadId.get(threadId)!.push(id);
    }
    for (const [threadId, ids] of byThreadId) {
      await db.message.updateMany({
        where: { id: { in: ids } },
        data: { threadId },
      });
    }
    console.log(`[sync] Repaired threadIds for ${fixes.length} messages`);
  }
}
