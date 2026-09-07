/**
 * Pure helpers behind the per-card reply UI (plan 055): which message the
 * composer targets, what a reply to a given card addresses, which cards are
 * already answered, and how an own card names its recipients.
 *
 * Client-safe (no db); the server builds the name map and the own-address
 * predicate, the thread components call these with plain data.
 */

export interface ThreadCardMessage {
  id: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  subject: string | null;
  fromAddress: string;
  fromName: string | null;
  replyTo?: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses?: string[];
  isAnswered?: boolean;
  sender?: { displayName: string | null } | null;
}

export interface ReplyOptions {
  /** Db id of the message the composer replies to. */
  messageId: string;
  replyToAddress: string;
  replyToName: string;
  replyAllExtraTo: string[];
  replyAllCc: string[];
  subject: string;
  rfcMessageId?: string;
  references: string[];
}

type IsOwn = (address: string) => boolean;
type NameFor = (address: string) => string;

const norm = (a: string) => a.trim().toLowerCase();

function dedupe(addresses: string[], skip: Set<string>): string[] {
  const out: string[] = [];
  for (const addr of addresses) {
    const key = norm(addr);
    if (!key || skip.has(key)) continue;
    skip.add(key);
    out.push(addr);
  }
  return out;
}

/** Recipients of an own message, own addresses removed, To before Cc. */
function externalRecipients(
  message: ThreadCardMessage,
  isOwn: IsOwn,
): { to: string[]; cc: string[] } {
  const seen = new Set<string>();
  const to = dedupe(message.toAddresses, seen).filter((a) => !isOwn(a));
  const cc = dedupe(message.ccAddresses, seen).filter((a) => !isOwn(a));
  return { to, cc };
}

/**
 * Reply parameters for one card. Incoming: reply to Reply-To/From, reply-all
 * adds the other external To/Cc. Own: reply to the first external recipient
 * (a sent-only thread or the user's own card), reply-all adds the rest.
 */
export function replyOptionsFor(
  message: ThreadCardMessage,
  isOwn: IsOwn,
  nameFor: NameFor,
): ReplyOptions {
  const base = {
    messageId: message.id,
    subject: message.subject || "(no subject)",
    rfcMessageId: message.messageId ?? undefined,
    references: message.references ?? [],
  };

  if (isOwn(message.fromAddress)) {
    const { to, cc } = externalRecipients(message, isOwn);
    const primary =
      to[0] ?? cc[0] ?? message.toAddresses[0] ?? message.fromAddress;
    const rest = to.slice(1);
    return {
      ...base,
      replyToAddress: primary,
      replyToName: nameFor(primary),
      replyAllExtraTo: rest,
      replyAllCc: to.length > 0 ? cc : cc.slice(1),
    };
  }

  const replyToAddress = message.replyTo || message.fromAddress;
  const skip = new Set<string>([norm(replyToAddress)]);
  const keep = (addr: string) => {
    const key = norm(addr);
    if (!key || skip.has(key) || isOwn(addr)) return false;
    skip.add(key);
    return true;
  };
  return {
    ...base,
    replyToAddress,
    replyToName:
      message.sender?.displayName || message.fromName || message.fromAddress,
    replyAllExtraTo: message.toAddresses.filter(keep),
    replyAllCc: message.ccAddresses.filter(keep),
  };
}

/**
 * Header label for a card: the counterpart's name for incoming mail; for own
 * mail "You → Name", "You → Name +N", "You → N recipients" (bcc-only
 * broadcast) or plain "You".
 */
export function cardLabel(
  message: ThreadCardMessage,
  isOwn: IsOwn,
  nameFor: NameFor,
): string {
  if (!isOwn(message.fromAddress)) {
    return (
      message.sender?.displayName || message.fromName || message.fromAddress
    );
  }
  const { to, cc } = externalRecipients(message, isOwn);
  const visible = [...to, ...cc];
  if (visible.length > 0) {
    const extra = visible.length - 1;
    return `You → ${nameFor(visible[0])}${extra > 0 ? ` +${extra}` : ""}`;
  }
  const bcc = (message.bccAddresses ?? []).filter((a) => !isOwn(a)).length;
  if (bcc > 0) {
    return `You → ${bcc} ${bcc === 1 ? "recipient" : "recipients"}`;
  }
  return "You";
}

/**
 * Db ids of cards the user has replied to: an own message in the thread
 * replies to them (inReplyTo), or the server flagged them answered.
 */
export function answeredMessageIds(
  messages: ThreadCardMessage[],
  isOwn: IsOwn,
): Set<string> {
  const repliedRfcIds = new Set<string>();
  for (const m of messages) {
    if (m.inReplyTo && isOwn(m.fromAddress)) repliedRfcIds.add(m.inReplyTo);
  }
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.isAnswered || (m.messageId && repliedRfcIds.has(m.messageId))) {
      answered.add(m.id);
    }
  }
  return answered;
}

/**
 * The card the composer targets when the thread opens: a pinned reply draft,
 * else the latest message not from the user, else the latest message.
 */
export function defaultReplyTargetId(
  messages: ThreadCardMessage[],
  isOwn: IsOwn,
  draftContextId?: string | null,
): string | null {
  if (draftContextId && messages.some((m) => m.id === draftContextId)) {
    return draftContextId;
  }
  const lastIncoming = [...messages].reverse().find((m) => !isOwn(m.fromAddress));
  return lastIncoming?.id ?? messages[messages.length - 1]?.id ?? null;
}
