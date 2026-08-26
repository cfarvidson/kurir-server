/**
 * Thin web wrappers: auth-gated, typed error results (not throws) so the
 * composer can branch on BODY_EXISTS, and a generate result that carries the
 * body the composer applies. The module itself is stubbed here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/draft-generation/credential", () => ({
  getDraftGenerationStatus: vi.fn(),
  saveDraftGenerationCredential: vi.fn(),
  removeDraftGenerationCredential: vi.fn(),
}));
vi.mock("@/lib/draft-generation/generate", () => ({
  generateDraftForUser: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitDraftGeneration: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
}));

import {
  generateDraft,
  getDraftGenerationSettings,
  saveDraftGenerationToken,
} from "@/actions/draft-generation";
import {
  saveDraftGenerationCredential,
  getDraftGenerationStatus,
} from "@/lib/draft-generation/credential";
import { generateDraftForUser } from "@/lib/draft-generation/generate";
import { DraftGenerationError } from "@/lib/draft-generation/types";
import { auth } from "@/lib/auth";
import { rateLimitDraftGeneration } from "@/lib/rate-limit";

describe("draft-generation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(rateLimitDraftGeneration).mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    });
  });

  it("settings action returns the connected state after a stubbed save", async () => {
    vi.mocked(saveDraftGenerationCredential).mockResolvedValue({
      connected: true,
      provider: "claudeCode",
    });
    const result = await saveDraftGenerationToken(
      "claudeCode",
      "sk-ant-oat01-x",
    );
    expect(result).toEqual({
      ok: true,
      status: { connected: true, provider: "claudeCode" },
    });

    vi.mocked(getDraftGenerationStatus).mockResolvedValue({
      connected: true,
      provider: "claudeCode",
    });
    expect(await getDraftGenerationSettings()).toEqual({
      connected: true,
      provider: "claudeCode",
    });
  });

  it("a rejected key comes back as { ok: false, code }, not a throw", async () => {
    vi.mocked(saveDraftGenerationCredential).mockRejectedValue(
      new DraftGenerationError("TOKEN_REJECTED", "Console key refused"),
    );
    const result = await saveDraftGenerationToken(
      "claudeCode",
      "sk-ant-api03-x",
    );
    expect(result).toEqual({
      ok: false,
      code: "TOKEN_REJECTED",
      error: "Console key refused",
    });
  });

  it("generate returns the draft body the composer applies", async () => {
    vi.mocked(generateDraftForUser).mockResolvedValue({
      type: "REPLY",
      contextMessageId: "m1",
      to: "ada@x.y",
      cc: "",
      bcc: "",
      subject: "Re-subject",
      body: "generated body",
    } as never);
    const result = await generateDraft({
      type: "REPLY",
      contextMessageId: "m1",
    });
    expect(result).toMatchObject({ ok: true, draft: { body: "generated body" } });
  });

  it("generate maps module errors to { ok: false, code } for the confirm flow", async () => {
    vi.mocked(generateDraftForUser).mockRejectedValue(
      new DraftGenerationError("BODY_EXISTS", "This draft already has a body."),
    );
    const result = await generateDraft({
      type: "REPLY",
      contextMessageId: "m1",
    });
    expect(result).toMatchObject({ ok: false, code: "BODY_EXISTS" });
  });

  it("generate is rate limited per user", async () => {
    vi.mocked(rateLimitDraftGeneration).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    });
    const result = await generateDraft({
      type: "REPLY",
      contextMessageId: "m1",
    });
    expect(result).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(generateDraftForUser).not.toHaveBeenCalled();
  });

  it("every action requires a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getDraftGenerationSettings()).rejects.toThrow("Unauthorized");
    await expect(
      saveDraftGenerationToken("claudeCode", "sk-ant-oat01-x"),
    ).rejects.toThrow("Unauthorized");
    await expect(
      generateDraft({ type: "REPLY", contextMessageId: "m1" }),
    ).rejects.toThrow("Unauthorized");
  });
});
