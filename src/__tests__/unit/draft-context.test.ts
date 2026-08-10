/**
 * resolveDraftContext - which draft key the composer autosaves under, from the
 * compose page's search params (plan 037). NEW gets a client-generated UUID so
 * several new-mail drafts can coexist; forward/reply keep their message key.
 */
import { describe, it, expect } from "vitest";
import { DraftType } from "@prisma/client";
import { resolveDraftContext } from "@/lib/mail/draft-context";

const gen = () => "generated-uuid";

describe("resolveDraftContext", () => {
  it("forward param wins: FORWARD keyed on the message id", () => {
    expect(
      resolveDraftContext(
        { forward: "msg-1", draft: null, draftType: null },
        gen,
      ),
    ).toEqual({ type: DraftType.FORWARD, contextMessageId: "msg-1" });
  });

  it("draft param reopens an existing NEW draft under its own id", () => {
    expect(
      resolveDraftContext(
        { forward: null, draft: "uuid-aaaa", draftType: null },
        gen,
      ),
    ).toEqual({ type: DraftType.NEW, contextMessageId: "uuid-aaaa" });
  });

  it("no params: a fresh NEW draft gets a generated id", () => {
    expect(
      resolveDraftContext({ forward: null, draft: null, draftType: null }, gen),
    ).toEqual({ type: DraftType.NEW, contextMessageId: "generated-uuid" });
  });

  it("orphaned reply/forward fallback keeps the original key", () => {
    expect(
      resolveDraftContext(
        { forward: null, draft: "msg-9", draftType: "REPLY" },
        gen,
      ),
    ).toEqual({ type: DraftType.REPLY, contextMessageId: "msg-9" });
    expect(
      resolveDraftContext(
        { forward: null, draft: "msg-9", draftType: "FORWARD" },
        gen,
      ),
    ).toEqual({ type: DraftType.FORWARD, contextMessageId: "msg-9" });
  });

  it("an unknown draftType falls back to NEW", () => {
    expect(
      resolveDraftContext(
        { forward: null, draft: "x", draftType: "JUNK" },
        gen,
      ).type,
    ).toBe(DraftType.NEW);
  });
});
