import { db } from "@/lib/db";
import {
  getOwnAddresses,
  isOwnAddress,
  type OwnAddresses,
} from "@/lib/mail/user-emails";

/**
 * Shared thread-assignment for every path that writes a message row: IMAP
 * ingest and all three send paths (immediate send, scheduled send, scheduled
 * send-now). Keeping one implementation is the point — the send paths used to
 * carry diverging copies with no root fallback and no unify pass, so an
 * app-composed mail could sit with threadId = null (or a reply could get a
 * thread key its anchor never joined) until ingest happened to repair it.
 *
 * Branches (plan 055): a reply to an own *broadcast* (a sent message whose To
 * and Cc hold no external address — everyone was bcc'd) starts a thread of
 * its own per replying address, so each counterpart's conversation is handled
 * one at a time. Every row in such a branch carries `splitFromThreadId` (the
 * original thread's key), which is what keeps the web/iOS linkage passes from
 * merging the branch back into the broadcast thread.
 */

export interface ThreadAssignment {
  threadId: string | null;
  /** Set on every row of a branch thread; null outside branches. */
  splitFromThreadId: string | null;
}

export interface ThreadAssignInput {
  userId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /**
   * Sender of the message being persisted plus the user's own addresses.
   * Both are needed for the broadcast-split rule; paths that can never
   * split (own sends) may omit them.
   */
  fromAddress?: string;
  own?: OwnAddresses;
}

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
 * Related Message-IDs ordered nearest ancestor first: inReplyTo, then the
 * References header read from the end (RFC order is oldest → newest).
 */
export function nearestFirstAncestorIds(
  inReplyTo: string | null,
  references: string[],
): string[] {
  const ordered: string[] = [];
  const push = (id: string | null) => {
    if (id && !ordered.includes(id)) ordered.push(id);
  };
  push(inReplyTo);
  for (let i = references.length - 1; i >= 0; i--) push(references[i]);
  return ordered;
}

/**
 * A broadcast is an own-sent message with no external To/Cc recipient: the
 * recipients were all bcc'd, so a reply from outside can only come from one
 * of them.
 */
export function isBroadcast(
  message: { fromAddress: string; toAddresses: string[]; ccAddresses: string[] },
  own: OwnAddresses,
): boolean {
  if (!isOwnAddress(message.fromAddress, own)) return false;
  return [...message.toAddresses, ...message.ccAddresses].every((addr) =>
    isOwnAddress(addr, own),
  );
}

const anchorSelect = {
  messageId: true,
  threadId: true,
  splitFromThreadId: true,
  fromAddress: true,
  toAddresses: true,
  ccAddresses: true,
} as const;

/**
 * Resolve the thread for a message about to be persisted:
 * 0. its nearest known ancestor is an own broadcast and the message comes
 *    from outside → a branch thread keyed per replying address
 *    (`splitFromThreadId` = the broadcast's thread key)
 * 1. a known related message that already has a threadId → reuse it (nearest
 *    ancestor first, so a reply inside a branch follows the branch even
 *    though its References still name the broadcast)
 * 2. otherwise the conversation root's Message-ID (references[0] || inReplyTo);
 *    the unify pass back-fills the anchor row so both end up grouped even when
 *    the anchor's threadId is still null
 * 3. otherwise (no relations at all) the message's own Message-ID, so a fresh
 *    conversation gets a non-null thread key at write time
 */
export async function resolveThread(
  opts: ThreadAssignInput,
): Promise<ThreadAssignment> {
  const ordered = nearestFirstAncestorIds(opts.inReplyTo, opts.references);

  if (ordered.length > 0) {
    const rows = await db.message.findMany({
      where: { userId: opts.userId, messageId: { in: ordered } },
      select: anchorSelect,
    });
    const byId = new Map(rows.map((r) => [r.messageId, r]));
    const anchor = ordered.map((id) => byId.get(id)).find((r) => r);

    if (
      anchor &&
      opts.messageId &&
      opts.fromAddress &&
      opts.own &&
      !isOwnAddress(opts.fromAddress, opts.own) &&
      isBroadcast(anchor, opts.own)
    ) {
      const splitFromThreadId = anchor.threadId ?? anchor.messageId;
      if (splitFromThreadId) {
        const existingBranch = await db.message.findFirst({
          where: {
            userId: opts.userId,
            splitFromThreadId,
            fromAddress: { equals: opts.fromAddress, mode: "insensitive" },
            threadId: { not: null },
          },
          orderBy: { receivedAt: "asc" },
          select: { threadId: true },
        });
        return {
          threadId: existingBranch?.threadId ?? opts.messageId,
          splitFromThreadId,
        };
      }
    }

    const keyed = ordered
      .map((id) => byId.get(id))
      .find((r) => r && r.threadId);
    if (keyed?.threadId) {
      return {
        threadId: keyed.threadId,
        splitFromThreadId: keyed.splitFromThreadId ?? null,
      };
    }

    const related = relatedMessageIds(opts.inReplyTo, opts.references);
    const byThread = await db.message.findFirst({
      where: {
        userId: opts.userId,
        threadId: { in: related },
      },
      select: { threadId: true, splitFromThreadId: true },
    });
    if (byThread?.threadId) {
      return {
        threadId: byThread.threadId,
        splitFromThreadId: byThread.splitFromThreadId ?? null,
      };
    }

    const root = opts.references[0] || opts.inReplyTo;
    if (root) return { threadId: root, splitFromThreadId: null };
  }

  return { threadId: opts.messageId || null, splitFromThreadId: null };
}

/** Thread key only; kept for callers that never write branch rows. */
export async function resolveThreadId(
  opts: ThreadAssignInput,
): Promise<string | null> {
  return (await resolveThread(opts)).threadId;
}

/**
 * Back-fill the resolved threadId across every known message in the same
 * conversation (rows the new message references, and rows that reply to those)
 * so divergent or null threadIds converge on one key.
 *
 * Never crosses a branch boundary: rows inside a branch are left alone, and a
 * branch thread pulls nothing in (its References name the broadcast and its
 * siblings, which belong to other threads by design).
 */
export async function unifyThreadId(
  userId: string,
  assignment: ThreadAssignment | string | null,
  related: string[],
): Promise<void> {
  const target =
    typeof assignment === "string"
      ? { threadId: assignment, splitFromThreadId: null }
      : assignment;
  if (!target?.threadId || target.splitFromThreadId || related.length === 0) {
    return;
  }
  await db.message.updateMany({
    where: {
      userId,
      splitFromThreadId: null,
      OR: [{ messageId: { in: related } }, { inReplyTo: { in: related } }],
      NOT: { threadId: target.threadId },
    },
    data: { threadId: target.threadId },
  });
}

/** Resolve + unify in one step. Every message write path goes through this. */
export async function assignThread(
  opts: ThreadAssignInput,
): Promise<ThreadAssignment> {
  const assignment = await resolveThread(opts);
  await unifyThreadId(
    opts.userId,
    assignment,
    relatedMessageIds(opts.inReplyTo, opts.references),
  );
  return assignment;
}

/** Thread key only; see `assignThread` for the branch-aware form. */
export async function assignThreadId(
  opts: ThreadAssignInput,
): Promise<string | null> {
  return (await assignThread(opts)).threadId;
}

interface RepairRow {
  id: string;
  messageId: string | null;
  threadId: string | null;
  splitFromThreadId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  sentAt: Date | null;
  receivedAt: Date;
}

interface RepairKey {
  threadId: string | null;
  splitFromThreadId: string | null;
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
 *
 * Branches are re-derived from the same rule ingest uses (external reply
 * whose known parent is an own broadcast), so a full sync splits threads that
 * predate the rule. A persisted branch root wins over the derived one, which
 * keeps repair idempotent with ingest and lets a future manual split survive.
 */
export async function repairThreadIds(userId: string): Promise<void> {
  const [messages, own] = await Promise.all([
    db.message.findMany({
      where: { userId },
      select: {
        id: true,
        messageId: true,
        threadId: true,
        splitFromThreadId: true,
        inReplyTo: true,
        references: true,
        fromAddress: true,
        toAddresses: true,
        ccAddresses: true,
        sentAt: true,
        receivedAt: true,
      },
    }) as Promise<RepairRow[]>,
    getOwnAddresses(userId),
  ]);

  const byMessageId = new Map<string, RepairRow>();
  for (const m of messages) {
    if (m.messageId) byMessageId.set(m.messageId, m);
  }

  function knownParentId(msg: RepairRow): string | null {
    if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) return msg.inReplyTo;
    for (let i = msg.references.length - 1; i >= 0; i--) {
      const ref = msg.references[i];
      if (ref !== msg.messageId && byMessageId.has(ref)) return ref;
    }
    return null;
  }

  const isBranchRootOf = (msg: RepairRow, parent: RepairRow) =>
    !!msg.messageId &&
    !isOwnAddress(msg.fromAddress, own) &&
    isBroadcast(parent, own);

  // Canonical root per (broadcast, replying address): a persisted root if one
  // exists, else the earliest direct external reply from that address.
  const rootCache = new Map<string, RepairRow>();
  function canonicalRoot(parent: RepairRow, msg: RepairRow): RepairRow {
    const key = `${parent.messageId} ${msg.fromAddress.trim().toLowerCase()}`;
    const cached = rootCache.get(key);
    if (cached) return cached;
    const siblings = messages.filter(
      (m) =>
        m.messageId &&
        m.fromAddress.trim().toLowerCase() ===
          msg.fromAddress.trim().toLowerCase() &&
        knownParentId(m) === parent.messageId &&
        isBranchRootOf(m, parent),
    );
    const persisted = siblings.find(
      (m) => m.splitFromThreadId && m.threadId === m.messageId,
    );
    const at = (m: RepairRow) => (m.sentAt ?? m.receivedAt).getTime();
    const root =
      persisted ??
      siblings.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id))[0] ??
      msg;
    rootCache.set(key, root);
    return root;
  }

  const keyCache = new Map<string, RepairKey>();
  function findThreadKey(msg: RepairRow, visiting = new Set<string>()): RepairKey {
    const cached = keyCache.get(msg.id);
    if (cached) return cached;
    if (visiting.has(msg.id)) return { threadId: null, splitFromThreadId: null };
    visiting.add(msg.id);

    let key: RepairKey;
    const parentId = knownParentId(msg);
    const parent = parentId ? byMessageId.get(parentId) : undefined;
    if (msg.splitFromThreadId && msg.threadId === msg.messageId) {
      // A persisted branch root wins over the derived rule.
      key = { threadId: msg.threadId, splitFromThreadId: msg.splitFromThreadId };
    } else if (parent && isBranchRootOf(msg, parent)) {
      const parentKey = findThreadKey(parent, visiting);
      const splitFromThreadId = parentKey.threadId ?? parent.messageId;
      key = {
        threadId: canonicalRoot(parent, msg).messageId,
        splitFromThreadId,
      };
    } else if (parent) {
      key = findThreadKey(parent, visiting);
    } else if (msg.inReplyTo || msg.references.length > 0) {
      // The chain's top still points at messages missing from the DB: its
      // assigned threadId (often one of those missing ids) is the best key we
      // have. Null means we know nothing better — skip instead of resetting.
      key = { threadId: msg.threadId, splitFromThreadId: msg.splitFromThreadId };
    } else {
      key = { threadId: msg.messageId, splitFromThreadId: null };
    }

    keyCache.set(msg.id, key);
    return key;
  }

  const fixes: { id: string; key: RepairKey }[] = [];
  for (const msg of messages) {
    const key = findThreadKey(msg);
    if (
      key.threadId &&
      (msg.threadId !== key.threadId ||
        (msg.splitFromThreadId ?? null) !== (key.splitFromThreadId ?? null))
    ) {
      fixes.push({ id: msg.id, key });
    }
  }

  if (fixes.length > 0) {
    const groups = new Map<string, { key: RepairKey; ids: string[] }>();
    for (const { id, key } of fixes) {
      const groupKey = `${key.threadId} ${key.splitFromThreadId ?? ""}`;
      const group = groups.get(groupKey) ?? { key, ids: [] };
      group.ids.push(id);
      groups.set(groupKey, group);
    }
    for (const { key, ids } of groups.values()) {
      await db.message.updateMany({
        where: { id: { in: ids } },
        data: {
          threadId: key.threadId,
          splitFromThreadId: key.splitFromThreadId ?? null,
        },
      });
    }
    console.log(`[sync] Repaired threadIds for ${fixes.length} messages`);
  }
}
