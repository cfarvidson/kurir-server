import { DraftType } from "@prisma/client";

/**
 * Resolve which draft key the full-page composer autosaves under, from its
 * search params (plan 037). Precedence: an explicit forward target -> FORWARD
 * on the message id; an explicit draft id (the catalog reopening a draft,
 * optionally with draftType for orphaned reply/forward contexts) -> that key;
 * otherwise a brand-new NEW draft under a client-generated id, so several
 * new-mail drafts can coexist. `"__new__"` is never generated anymore, but
 * old rows still open fine via the draft param.
 */
export function resolveDraftContext(
  params: {
    forward: string | null;
    draft: string | null;
    draftType: string | null;
  },
  generateId: () => string,
): { type: DraftType; contextMessageId: string } {
  if (params.forward) {
    return { type: DraftType.FORWARD, contextMessageId: params.forward };
  }
  const type =
    params.draftType === "REPLY"
      ? DraftType.REPLY
      : params.draftType === "FORWARD"
        ? DraftType.FORWARD
        : DraftType.NEW;
  return { type, contextMessageId: params.draft ?? generateId() };
}
