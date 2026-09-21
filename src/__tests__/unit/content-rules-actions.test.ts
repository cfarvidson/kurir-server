/**
 * Thin web wrappers for AI content rules: auth-gated, typed error results
 * (not throws) so the rules page can show the store's validation messages,
 * and a "Check now" that only kicks the detached run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/mail/content-rule-store", () => ({
  addContentRuleSenderForUser: vi.fn(),
  createContentRuleForUser: vi.fn(),
  deleteContentRuleForUser: vi.fn(),
  kickContentRuleEvaluation: vi.fn(),
  recheckContentRuleForUser: vi.fn(),
  removeContentRuleSenderForUser: vi.fn(),
  updateContentRuleForUser: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitContentRules: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
}));

import {
  createContentRule,
  deleteContentRule,
  recheckContentRule,
  runContentRules,
  updateContentRule,
} from "@/actions/content-rules";
import {
  createContentRuleForUser,
  deleteContentRuleForUser,
  kickContentRuleEvaluation,
  recheckContentRuleForUser,
  updateContentRuleForUser,
} from "@/lib/mail/content-rule-store";
import { auth } from "@/lib/auth";
import { rateLimitContentRules } from "@/lib/rate-limit";

const input = {
  criterion: "2 dagar remote",
  onMatch: "IMBOX" as const,
  onNoMatch: "KEEP" as const,
  sender: {
    scope: "DOMAIN" as const,
    scopeValue: "consult.se",
    includeExisting: true,
  },
};

describe("content-rules actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(rateLimitContentRules).mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    });
  });

  it("rejects an unauthenticated caller before touching the store", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(createContentRule(input)).rejects.toThrow("Unauthorized");
    expect(createContentRuleForUser).not.toHaveBeenCalled();
  });

  it("creates for the session user and kicks a first check", async () => {
    vi.mocked(createContentRuleForUser).mockResolvedValue({ id: "rule-1" });
    const result = await createContentRule(input);
    expect(result).toEqual({ ok: true });
    expect(createContentRuleForUser).toHaveBeenCalledWith("user-1", input);
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith("user-1");
  });

  it("returns the store's validation message instead of throwing", async () => {
    vi.mocked(createContentRuleForUser).mockRejectedValue(
      new Error("Enter a domain, like example.com."),
    );
    const result = await createContentRule(input);
    expect(result).toEqual({
      ok: false,
      error: "Enter a domain, like example.com.",
    });
    expect(kickContentRuleEvaluation).not.toHaveBeenCalled();
  });

  it("kicks a fresh check only when an edit asked to re-judge", async () => {
    vi.mocked(updateContentRuleForUser).mockResolvedValueOnce({
      rejudge: false,
    });
    await expect(
      updateContentRule("rule-1", { onMatch: "FEED" }),
    ).resolves.toEqual({ ok: true });
    expect(kickContentRuleEvaluation).not.toHaveBeenCalled();

    vi.mocked(updateContentRuleForUser).mockResolvedValueOnce({
      rejudge: true,
    });
    await expect(
      updateContentRule("rule-1", { criterion: "new wording", recheck: true }),
    ).resolves.toEqual({ ok: true });
    expect(updateContentRuleForUser).toHaveBeenLastCalledWith(
      "user-1",
      "rule-1",
      {
        criterion: "new wording",
        recheck: true,
      },
    );
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith("user-1");
  });

  it("maps a store rejection on delete to a typed failure", async () => {
    vi.mocked(deleteContentRuleForUser).mockRejectedValue(
      new Error("Rule not found"),
    );
    expect(await deleteContentRule("rule-9")).toEqual({
      ok: false,
      error: "Rule not found",
    });
  });

  it("Re-check last 30 days re-judges the rule, kicks a run, and is rate limited", async () => {
    expect(await recheckContentRule("rule-1")).toEqual({ ok: true });
    expect(recheckContentRuleForUser).toHaveBeenCalledWith("user-1", "rule-1");
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith("user-1");

    vi.mocked(rateLimitContentRules).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });
    const limited = await recheckContentRule("rule-1");
    expect(limited.ok).toBe(false);
    expect(recheckContentRuleForUser).toHaveBeenCalledTimes(1);
  });

  it("Check now kicks the detached run and is rate limited", async () => {
    expect(await runContentRules()).toEqual({ ok: true });
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith("user-1");

    vi.mocked(rateLimitContentRules).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });
    const limited = await runContentRules();
    expect(limited.ok).toBe(false);
    expect(kickContentRuleEvaluation).toHaveBeenCalledTimes(1);
  });
});
