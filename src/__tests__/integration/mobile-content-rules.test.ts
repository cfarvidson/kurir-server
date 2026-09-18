/**
 * Integration tests for /api/mobile/content-rules — the mobile surface over
 * the shared content-rule store. Auth, CRUD round trip, ownership 404s,
 * and the rate-limited Check now kick.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(() => {
    throw new Error("updateTag can only be called from within a Server Action");
  }),
  revalidatePath: vi.fn(() => {
    throw new Error(
      "revalidatePath can only be called from within a Server Action",
    );
  }),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
    rateLimitContentRules: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

vi.mock("@/lib/mail/content-rule-store", () => ({
  listContentRulesForUser: vi.fn(),
  createContentRuleForUser: vi.fn(),
  addContentRuleSenderForUser: vi.fn(),
  removeContentRuleSenderForUser: vi.fn(),
  updateContentRuleForUser: vi.fn(),
  listContentRuleJudgementsForUser: vi.fn(),
  deleteContentRuleForUser: vi.fn(),
  kickContentRuleEvaluation: vi.fn(),
}));

function makeRequest(body?: unknown, query = "") {
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: new URLSearchParams(query) },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as never;
}

const params = <T extends Record<string, string>>(p: T) => ({
  params: Promise.resolve(p),
});

const USER = "user-1";

const createInput = {
  criterion: "two remote days a week",
  onMatch: "IMBOX",
  onNoMatch: "KEEP",
  sender: {
    scope: "DOMAIN",
    scopeValue: "consult.se",
    includeExisting: true,
  },
};

const ruleRow = {
  id: "rule-1",
  criterion: createInput.criterion,
  onMatch: "IMBOX",
  onNoMatch: "KEEP",
  emailConnectionId: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  senders: [
    {
      id: "snd-1",
      scope: "DOMAIN",
      scopeValue: "consult.se",
      since: new Date("2026-08-01T00:00:00Z"),
    },
  ],
  _count: { matches: 0 },
  matchedCount: 0,
  matches: [],
};

async function listRoute() {
  return import("@/app/api/mobile/content-rules/route");
}
async function detailRoute() {
  return import("@/app/api/mobile/content-rules/[id]/route");
}
async function sendersRoute() {
  return import("@/app/api/mobile/content-rules/[id]/senders/route");
}
async function senderRoute() {
  return import("@/app/api/mobile/content-rules/[id]/senders/[senderId]/route");
}
async function judgementsRoute() {
  return import("@/app/api/mobile/content-rules/[id]/judgements/route");
}
async function runRoute() {
  return import("@/app/api/mobile/content-rules/run/route");
}

describe("mobile content-rules routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue({
      userId: USER,
      sessionId: "s1",
    } as never);
  });

  it("returns 401 without a mobile bearer token", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);
    const { GET } = await listRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("lists the caller's rules", async () => {
    const { listContentRulesForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(listContentRulesForUser).mockResolvedValue([ruleRow] as never);
    const { GET } = await listRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].id).toBe("rule-1");
    expect(listContentRulesForUser).toHaveBeenCalledWith(USER);
  });

  it("creates a rule, kicks evaluation, and returns it", async () => {
    const {
      createContentRuleForUser,
      listContentRulesForUser,
      kickContentRuleEvaluation,
    } = await import("@/lib/mail/content-rule-store");
    vi.mocked(createContentRuleForUser).mockResolvedValue({ id: "rule-1" });
    vi.mocked(listContentRulesForUser).mockResolvedValue([ruleRow] as never);
    const { POST } = await listRoute();
    const res = await POST(makeRequest(createInput));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.id).toBe("rule-1");
    expect(createContentRuleForUser).toHaveBeenCalledWith(USER, createInput);
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith(USER);
  });

  it("returns the store's validation message as 400", async () => {
    const { createContentRuleForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(createContentRuleForUser).mockRejectedValue(
      new Error("Enter a domain, like example.com."),
    );
    const { POST } = await listRoute();
    const res = await POST(makeRequest(createInput));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Enter a domain, like example.com.",
    });
  });

  it("returns 404 when updating someone else's rule", async () => {
    const { updateContentRuleForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(updateContentRuleForUser).mockRejectedValue(
      new Error("Rule not found"),
    );
    const { PATCH } = await detailRoute();
    const res = await PATCH(
      makeRequest({ criterion: "new wording" }),
      params({ id: "rule-x" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Rule not found" });
  });

  it("updates a criterion and kicks when recheck is set", async () => {
    const {
      updateContentRuleForUser,
      listContentRulesForUser,
      kickContentRuleEvaluation,
    } = await import("@/lib/mail/content-rule-store");
    vi.mocked(updateContentRuleForUser).mockResolvedValue({ rejudge: true });
    vi.mocked(listContentRulesForUser).mockResolvedValue([
      { ...ruleRow, criterion: "new wording" },
    ] as never);
    const { PATCH } = await detailRoute();
    const res = await PATCH(
      makeRequest({ criterion: "new wording", recheck: true }),
      params({ id: "rule-1" }),
    );
    expect(res.status).toBe(200);
    expect(updateContentRuleForUser).toHaveBeenCalledWith(USER, "rule-1", {
      criterion: "new wording",
      recheck: true,
    });
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith(USER);
  });

  it("deletes a rule", async () => {
    const { deleteContentRuleForUser } =
      await import("@/lib/mail/content-rule-store");
    const { DELETE } = await detailRoute();
    const res = await DELETE(makeRequest(), params({ id: "rule-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(deleteContentRuleForUser).toHaveBeenCalledWith(USER, "rule-1");
  });

  it("adds a sender and kicks evaluation", async () => {
    const {
      addContentRuleSenderForUser,
      listContentRulesForUser,
      kickContentRuleEvaluation,
    } = await import("@/lib/mail/content-rule-store");
    vi.mocked(listContentRulesForUser).mockResolvedValue([ruleRow] as never);
    const { POST } = await sendersRoute();
    const res = await POST(
      makeRequest({
        scope: "ADDRESS",
        scopeValue: "ada@consult.se",
        includeExisting: false,
      }),
      params({ id: "rule-1" }),
    );
    expect(res.status).toBe(200);
    expect(addContentRuleSenderForUser).toHaveBeenCalledWith(USER, "rule-1", {
      scope: "ADDRESS",
      scopeValue: "ada@consult.se",
      includeExisting: false,
    });
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith(USER);
  });

  it("returns 404 when removing someone else's sender", async () => {
    const { removeContentRuleSenderForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(removeContentRuleSenderForUser).mockRejectedValue(
      new Error("Sender not found"),
    );
    const { DELETE } = await senderRoute();
    const res = await DELETE(
      makeRequest(),
      params({ id: "rule-1", senderId: "snd-x" }),
    );
    expect(res.status).toBe(404);
  });

  it("kicks Check now", async () => {
    const { kickContentRuleEvaluation } =
      await import("@/lib/mail/content-rule-store");
    const { POST } = await runRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(kickContentRuleEvaluation).toHaveBeenCalledWith(USER);
  });

  it("lists every verdict for a rule, misses included", async () => {
    const { listContentRuleJudgementsForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(listContentRuleJudgementsForUser).mockResolvedValue({
      judgedCount: 2,
      matchedCount: 1,
      nextCursor: "match-2",
      judgements: [
        {
          id: "match-1",
          matched: true,
          reason: "Two remote days",
          appliedAction: "IMBOX",
          createdAt: new Date("2026-09-02T00:00:00Z"),
          message: {
            id: "msg-1",
            subject: "Uppdrag i Uppsala",
            fromAddress: "hej@consult.se",
            fromName: "Consult",
            receivedAt: new Date("2026-09-01T00:00:00Z"),
          },
        },
        {
          id: "match-2",
          matched: false,
          reason: "On site five days",
          appliedAction: "KEEP",
          createdAt: new Date("2026-09-01T00:00:00Z"),
          message: {
            id: "msg-2",
            subject: null,
            fromAddress: "hej@consult.se",
            fromName: null,
            receivedAt: new Date("2026-08-31T00:00:00Z"),
          },
        },
      ],
    } as never);
    const { GET } = await judgementsRoute();
    const res = await GET(
      makeRequest(undefined, "limit=2&cursor=match-0"),
      params({ id: "rule-1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.judgedCount).toBe(2);
    expect(body.matchedCount).toBe(1);
    expect(body.nextCursor).toBe("match-2");
    expect(body.judgements.map((j: { matched: boolean }) => j.matched)).toEqual(
      [true, false],
    );
    expect(body.judgements[0].messageId).toBe("msg-1");
    expect(listContentRuleJudgementsForUser).toHaveBeenCalledWith(
      USER,
      "rule-1",
      { limit: 2, cursor: "match-0" },
    );
  });

  it("returns 404 for another user's judged mail", async () => {
    const { listContentRuleJudgementsForUser } =
      await import("@/lib/mail/content-rule-store");
    vi.mocked(listContentRuleJudgementsForUser).mockRejectedValue(
      new Error("Rule not found"),
    );
    const { GET } = await judgementsRoute();
    const res = await GET(makeRequest(), params({ id: "rule-x" }));
    expect(res.status).toBe(404);
  });

  it("returns 429 when Check now is rate-limited", async () => {
    const { rateLimitContentRules } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitContentRules).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });
    const { POST } = await runRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
  });
});
