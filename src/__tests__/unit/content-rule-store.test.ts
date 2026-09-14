/**
 * AI content rules: the evaluator and the store's ownership guards.
 * Candidates go to the stub adapter once per rule, verdicts are stored for
 * hits and misses, and the rule's actions re-file only untouched messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import type { InferenceAdapter } from "@/lib/draft-generation/types";
import { DraftGenerationError } from "@/lib/draft-generation/types";
import {
  addContentRuleSenderForUser,
  createContentRuleForUser,
  deleteContentRuleForUser,
  evaluateContentRulesForUser,
  kickContentRuleEvaluation,
  MAX_PER_RULE_PER_RUN,
  removeContentRuleSenderForUser,
  resetContentRuleKicks,
  updateContentRuleForUser,
} from "@/lib/mail/content-rule-store";

vi.mock("@/lib/db", () => ({
  db: {
    contentRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contentRuleSender: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    contentRuleMatch: { upsert: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    message: { findMany: vi.fn(), updateMany: vi.fn() },
    draftGenerationCredential: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/mail/archive-imap", () => ({ moveToArchiveViaImap: vi.fn() }));
vi.mock("@/lib/mail/sse-subscribers", () => ({ emitToUser: vi.fn() }));
// The kicker uses the real adapter; keep it off the network.
vi.mock("@/lib/draft-generation/providers", () => ({
  defaultInferenceAdapter: vi.fn(async () => '{"match": false}'),
}));

import { db } from "@/lib/db";
import { revalidateTag } from "next/cache";
import { moveToArchiveViaImap } from "@/lib/mail/archive-imap";
import { emitToUser } from "@/lib/mail/sse-subscribers";

const updatedAt = new Date("2026-09-01T00:00:00Z");
const rule = {
  id: "rule-1",
  criterion: "2 dagar remote i Uppsala",
  onMatch: "IMBOX",
  onNoMatch: "ARCHIVE",
  emailConnectionId: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt,
  senders: [{ scope: "DOMAIN", scopeValue: "consult.se" }],
};

function message(id: string, fromAddress = "anna@consult.se") {
  return {
    id,
    uid: 100,
    folderId: "folder-inbox",
    emailConnectionId: "conn-1",
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
  vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.contentRule.findUnique).mockResolvedValue({ updatedAt } as never);
});

describe("evaluateContentRulesForUser", () => {
  it("skips without a draft-generation credential and never queries mail", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue(null);
    const infer = vi.fn<InferenceAdapter>();

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({
      evaluated: 0,
      matched: 0,
      refiled: 0,
      capped: false,
      skipped: "NO_CREDENTIAL",
    });
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

    expect(result).toEqual({ evaluated: 2, matched: 1, refiled: 2, capped: false });
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
    // Filing into a category only touches untouched, unarchived mail.
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: {
        id: "m-hit",
        isDeleted: false,
        isSnoozed: false,
        isReplyLater: false,
        isFollowUp: false,
        isArchived: false,
      },
      data: expect.objectContaining({ isInImbox: true, isArchived: false }),
    });
    // Archiving skips the isArchived guard (already archived is a no-op anyway).
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: {
        id: "m-miss",
        isDeleted: false,
        isSnoozed: false,
        isReplyLater: false,
        isFollowUp: false,
      },
      data: expect.objectContaining({ isInImbox: false, isArchived: true }),
    });
    expect(moveToArchiveViaImap).toHaveBeenCalledWith("u1", "conn-1", "folder-inbox", [100]);
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith("sidebar-counts", { expire: 0 });
  });

  it("counts a message the user touched meanwhile as not re-filed", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([message("m-1")] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 0 } as never);
    const infer = vi.fn<InferenceAdapter>(async () => '{"match": false}');

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 1, matched: 0, refiled: 0, capped: false });
    expect(moveToArchiveViaImap).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("asks only for undeleted inbox mail the rule has not judged, from its senders and inbox", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([
      { ...rule, emailConnectionId: "conn-1" },
    ] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);

    await evaluateContentRulesForUser("u1", vi.fn<InferenceAdapter>());

    const where = vi.mocked(db.message.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({
      userId: "u1",
      emailConnectionId: "conn-1",
      folder: { specialUse: "inbox" },
      isDeleted: false,
      contentRuleMatches: { none: { ruleId: "rule-1" } },
      OR: [{ fromAddress: { endsWith: "@consult.se", mode: "insensitive" } }],
    });
  });

  it("leaves an unreadable answer unstored so the message is retried next run", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([message("m-1")] as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infer = vi.fn<InferenceAdapter>(async () => "Sure! It depends.");

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result).toEqual({ evaluated: 0, matched: 0, refiled: 0, capped: false });
    expect(db.contentRuleMatch.upsert).not.toHaveBeenCalled();
    expect(db.message.updateMany).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("discards a verdict when the rule was edited or deleted while the model ran", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      message("m-1"),
      message("m-2"),
    ] as never);
    vi.mocked(db.contentRule.findUnique).mockResolvedValue({
      updatedAt: new Date("2026-09-12T00:00:00Z"),
    } as never);
    const infer = vi.fn<InferenceAdapter>(async () => '{"match": true}');

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result.evaluated).toBe(0);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(db.contentRuleMatch.upsert).not.toHaveBeenCalled();
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

    expect(result).toEqual({ evaluated: 1, matched: 1, refiled: 0, capped: false });
    expect(infer).toHaveBeenCalledTimes(1);
    expect(db.message.updateMany).not.toHaveBeenCalled();
  });

  it("reports capped when a rule filled its per-run budget", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue(
      Array.from({ length: MAX_PER_RULE_PER_RUN }, (_, i) => message(`m-${i}`)) as never,
    );
    const infer = vi.fn<InferenceAdapter>(async () => '{"match": false}');

    const result = await evaluateContentRulesForUser("u1", infer);

    expect(result.capped).toBe(true);
    expect(result.evaluated).toBe(MAX_PER_RULE_PER_RUN);
  });

  it("stops the whole run on a credential error but confines other failures to their rule", async () => {
    mockCredential();
    const other = { ...rule, id: "rule-2" };
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule, other] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([message("m-1")] as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // Rule 1's match write blows up (rule deleted mid-run); rule 2 still runs.
    vi.mocked(db.contentRuleMatch.upsert).mockRejectedValueOnce(new Error("FK"));
    const infer = vi.fn<InferenceAdapter>(async () => '{"match": true}');
    const result = await evaluateContentRulesForUser("u1", infer);
    expect(infer).toHaveBeenCalledTimes(2);
    expect(result.evaluated).toBe(1);

    // A dead token is fatal for every rule.
    vi.clearAllMocks();
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule, other] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([message("m-1")] as never);
    const dead = vi.fn<InferenceAdapter>(async () => {
      throw new DraftGenerationError("TOKEN_DEAD", "dead");
    });
    await expect(evaluateContentRulesForUser("u1", dead)).rejects.toThrow("dead");
    expect(dead).toHaveBeenCalledTimes(1);
    error.mockRestore();
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

  it("keeps running while a rule is still capped", async () => {
    mockCredential();
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany)
      .mockResolvedValueOnce(
        Array.from({ length: MAX_PER_RULE_PER_RUN }, (_, i) => message(`m-${i}`)) as never,
      )
      .mockResolvedValue([] as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    kickContentRuleEvaluation("u1");
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));

    // A first pass that filled its budget triggers a second, draining pass.
    expect(db.message.findMany).toHaveBeenCalledTimes(2);
    log.mockRestore();
  }, 10_000);
});

describe("ownership guards", () => {
  it("refuses to add a sender to, update, or delete another user's rule", async () => {
    vi.mocked(db.contentRule.findUnique).mockResolvedValue({
      id: "rule-1",
      userId: "someone-else",
    } as never);

    await expect(
      addContentRuleSenderForUser("u1", "rule-1", { scope: "DOMAIN", scopeValue: "x.se" }),
    ).rejects.toThrow("Rule not found");
    await expect(
      updateContentRuleForUser("u1", "rule-1", { onMatch: "IMBOX" }),
    ).rejects.toThrow("Rule not found");
    await expect(deleteContentRuleForUser("u1", "rule-1")).rejects.toThrow(
      "Rule not found",
    );
    expect(db.contentRuleSender.upsert).not.toHaveBeenCalled();
    expect(db.contentRule.update).not.toHaveBeenCalled();
    expect(db.contentRule.delete).not.toHaveBeenCalled();
  });

  it("refuses to remove a sender row whose rule belongs to another user", async () => {
    vi.mocked(db.contentRuleSender.findUnique).mockResolvedValue({
      id: "s-1",
      rule: { userId: "someone-else" },
    } as never);

    await expect(removeContentRuleSenderForUser("u1", "s-1")).rejects.toThrow(
      "Sender not found",
    );
    expect(db.contentRuleSender.delete).not.toHaveBeenCalled();
  });

  it("refuses to bind a new rule to another user's inbox", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue({
      userId: "someone-else",
    } as never);

    await expect(
      createContentRuleForUser("u1", {
        criterion: "x",
        onMatch: "KEEP",
        onNoMatch: "KEEP",
        emailConnectionId: "conn-9",
        sender: { scope: "DOMAIN", scopeValue: "x.se" },
      }),
    ).rejects.toThrow("Inbox not found");
    expect(db.contentRule.create).not.toHaveBeenCalled();
  });

  it("deleting an already-gone rule is a no-op", async () => {
    vi.mocked(db.contentRule.findUnique).mockResolvedValue(null);
    await expect(deleteContentRuleForUser("u1", "rule-x")).resolves.toBeUndefined();
    expect(db.contentRule.delete).not.toHaveBeenCalled();
  });
});
