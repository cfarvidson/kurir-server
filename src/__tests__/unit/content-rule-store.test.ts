/**
 * AI content rules: the evaluator. Candidates go to the stub adapter once
 * per rule, verdicts are stored for hits and misses, and the rule's actions
 * re-file only messages the model actually answered for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import type { InferenceAdapter } from "@/lib/draft-generation/types";
import {
  evaluateContentRulesForUser,
  kickContentRuleEvaluation,
  resetContentRuleKicks,
} from "@/lib/mail/content-rule-store";

vi.mock("@/lib/db", () => ({
  db: {
    contentRule: { findMany: vi.fn() },
    contentRuleMatch: { upsert: vi.fn() },
    message: { findMany: vi.fn(), update: vi.fn() },
    draftGenerationCredential: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { db } from "@/lib/db";

const rule = {
  id: "rule-1",
  criterion: "2 dagar remote i Uppsala",
  onMatch: "IMBOX",
  onNoMatch: "ARCHIVE",
  emailConnectionId: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  senders: [{ scope: "DOMAIN", scopeValue: "consult.se" }],
};

function message(id: string, fromAddress = "anna@consult.se") {
  return {
    id,
    subject: `Profil ${id}`,
    fromAddress,
    fromName: null,
    receivedAt: new Date("2026-09-10T00:00:00Z"),
    textBody: `body ${id}`,
    htmlBody: null,
  };
}

function mockCredential() {
  vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
    provider: "claudeCode",
    encryptedSecret: encrypt("sk-ant-oat01-test"),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetContentRuleKicks();
  vi.mocked(db.contentRuleMatch.upsert).mockResolvedValue({} as never);
  vi.mocked(db.message.update).mockResolvedValue({} as never);
});

describe("evaluateContentRulesForUser", () => {
  it("skips without a draft-generation credential and never queries mail", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue(null);
    const infer = vi.fn<InferenceAdapter>();

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 0, matched: 0, skipped: "NO_CREDENTIAL" });
    expect(db.contentRule.findMany).not.toHaveBeenCalled();
    expect(infer).not.toHaveBeenCalled();
  });

  it("stores a verdict per candidate and files each by the rule's actions", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      message("m-hit"),
      message("m-miss"),
    ] as never);
    const infer = vi.fn<InferenceAdapter>(async ({ request }) =>
      request.user.includes("body m-hit")
        ? '{"match": true, "reason": "Två dagar remote, Uppsala."}'
        : '{"match": false, "reason": "Helt på plats."}',
    );

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 2, matched: 1 });
    expect(infer).toHaveBeenCalledTimes(2);
    expect(infer.mock.calls[0][0].request.user).toContain(
      "2 dagar remote i Uppsala",
    );
    expect(db.contentRuleMatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ruleId_messageId: { ruleId: "rule-1", messageId: "m-hit" } },
        create: expect.objectContaining({ matched: true, reason: "Två dagar remote, Uppsala." }),
      }),
    );
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m-hit" },
      data: expect.objectContaining({ isInImbox: true, isArchived: false }),
    });
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: "m-miss" },
      data: expect.objectContaining({ isInImbox: false, isArchived: true }),
    });
  });

  it("asks only for messages the rule has not judged, from its senders, in the inbox", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);

    await evaluateContentRulesForUser("u1", vi.fn<InferenceAdapter>());

    const where = vi.mocked(db.message.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({
      userId: "u1",
      folder: { specialUse: "inbox" },
      contentRuleMatches: { none: { ruleId: "rule-1" } },
      OR: [{ fromAddress: { endsWith: "@consult.se", mode: "insensitive" } }],
    });
  });

  it("records an unreadable answer as a miss without moving the message", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([message("m-1")] as never);
    const infer = vi.fn<InferenceAdapter>(async () => "Sure! It depends.");

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 1, matched: 0 });
    expect(db.contentRuleMatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matched: false }),
      }),
    );
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it("leaves a message alone when the action is KEEP and skips senders outside scope", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([
      { ...rule, onMatch: "KEEP", onNoMatch: "KEEP" },
    ] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      message("m-1"),
      message("m-out", "someone@else.se"),
    ] as never);
    const infer = vi.fn<InferenceAdapter>(async () => '{"match": true}');

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 1, matched: 1 });
    expect(infer).toHaveBeenCalledTimes(1);
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it("stops the run and rethrows when the model call fails", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      message("m-1"),
      message("m-2"),
    ] as never);
    const infer = vi.fn<InferenceAdapter>(async () => {
      throw new Error("token dead");
    });

    await expect(evaluateContentRulesForUser("u1", infer)).rejects.toThrow(
      "token dead",
    );
    expect(infer).toHaveBeenCalledTimes(1);
    expect(db.contentRuleMatch.upsert).not.toHaveBeenCalled();
  });
});

describe("kickContentRuleEvaluation", () => {
  it("serializes kicks per user, reruns once for a kick that landed mid-run, and swallows failures", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockRejectedValue(
      new Error("db down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    kickContentRuleEvaluation("u1");
    kickContentRuleEvaluation("u1");
    await new Promise((r) => setTimeout(r, 0));

    // First kick runs; the second lands mid-run and is folded into exactly
    // one rerun, not a concurrent evaluation.
    expect(db.draftGenerationCredential.findUnique).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
