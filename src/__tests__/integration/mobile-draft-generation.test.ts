/**
 * Integration tests for /api/mobile/draft-generation(+/generate) — auth,
 * classification errors on PUT, a secret-free GET, and the status mapping
 * (403 demo, 409 body-exists, 422 credential-state) native relies on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";

vi.mock("@/lib/db", () => ({
  db: {
    draftGenerationCredential: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    draft: { findUnique: vi.fn(), upsert: vi.fn() },
    message: { findFirst: vi.fn(), findMany: vi.fn() },
    emailConnection: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { count: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/demo", () => ({ isDemoInstance: vi.fn(() => false) }));
vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
    rateLimitDraftGeneration: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";

function makeRequest(body?: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as never;
}

async function mockAuthed(userId = "user-1") {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId });
}

async function mockUnauthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue(null);
}

describe("/api/mobile/draft-generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
  });

  it("every verb requires a mobile session", async () => {
    await mockUnauthed();
    const { GET, PUT, DELETE } = await import(
      "@/app/api/mobile/draft-generation/route"
    );
    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    expect((await GET(makeRequest())).status).toBe(401);
    expect(
      (await PUT(makeRequest({ provider: "claudeCode", token: "x" }))).status,
    ).toBe(401);
    expect((await DELETE(makeRequest())).status).toBe(401);
    expect(
      (
        await POST(makeRequest({ type: "REPLY", contextMessageId: "m1" }))
      ).status,
    ).toBe(401);
  });

  it("GET reports connected + provider and the payload never includes a token", async () => {
    await mockAuthed();
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "claudeCode",
    } as never);
    const { GET } = await import("@/app/api/mobile/draft-generation/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: true, provider: "claudeCode" });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("PUT with a Console API key is 400 with a code and writes nothing", async () => {
    await mockAuthed();
    const { PUT } = await import("@/app/api/mobile/draft-generation/route");
    const res = await PUT(
      makeRequest({ provider: "claudeCode", token: "sk-ant-api03-oops" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("TOKEN_REJECTED");
    expect(db.draftGenerationCredential.upsert).not.toHaveBeenCalled();
  });

  it("PUT with a setup-token stores ciphertext and reports connected", async () => {
    await mockAuthed();
    const { PUT } = await import("@/app/api/mobile/draft-generation/route");
    const res = await PUT(
      makeRequest({ provider: "claudeCode", token: "sk-ant-oat01-xyz" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: true,
      provider: "claudeCode",
    });
    const call = vi.mocked(db.draftGenerationCredential.upsert).mock
      .calls[0][0] as { create: { encryptedSecret: string } };
    expect(call.create.encryptedSecret).not.toContain("sk-ant-oat01-xyz");
  });

  it("PUT on the demo instance is 403 and writes nothing", async () => {
    await mockAuthed();
    vi.mocked(isDemoInstance).mockReturnValue(true);
    const { PUT } = await import("@/app/api/mobile/draft-generation/route");
    const res = await PUT(
      makeRequest({ provider: "claudeCode", token: "sk-ant-oat01-xyz" }),
    );
    expect(res.status).toBe(403);
    expect(db.draftGenerationCredential.upsert).not.toHaveBeenCalled();
  });

  it("DELETE disconnects", async () => {
    await mockAuthed();
    vi.mocked(db.draftGenerationCredential.deleteMany).mockResolvedValue({
      count: 1,
    } as never);
    const { DELETE } = await import("@/app/api/mobile/draft-generation/route");
    const res = await DELETE(makeRequest());
    expect(await res.json()).toEqual({ connected: false, provider: null });
  });
});

describe("/api/mobile/draft-generation/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
  });

  it("generate without a stored credential is 422 with NO_CREDENTIAL", async () => {
    await mockAuthed();
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue(
      null as never,
    );
    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    const res = await POST(
      makeRequest({ type: "REPLY", contextMessageId: "m1" }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("NO_CREDENTIAL");
  });

  it("generate over a typed body without replace is 409 and the draft is untouched", async () => {
    await mockAuthed();
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "claudeCode",
      encryptedSecret: encrypt("sk-ant-oat01-test"),
    } as never);
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      subject: "S",
      fromAddress: "ada@x.y",
      fromName: null,
      replyTo: null,
      toAddresses: [],
      textBody: "hello",
      htmlBody: null,
    } as never);
    vi.mocked(db.draft.findUnique).mockResolvedValue({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "already typed",
      emailConnectionId: null,
      attachmentIds: [],
    } as never);

    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    const res = await POST(
      makeRequest({ type: "REPLY", contextMessageId: "m1" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("BODY_EXISTS");
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("generate for a FORWARD is 400", async () => {
    await mockAuthed();
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "claudeCode",
      encryptedSecret: encrypt("sk-ant-oat01-test"),
    } as never);
    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    const res = await POST(
      makeRequest({ type: "FORWARD", contextMessageId: "m1" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("UNSUPPORTED_TYPE");
  });

  it("generate on the demo instance is 403 with no outbound inference", async () => {
    await mockAuthed();
    vi.mocked(isDemoInstance).mockReturnValue(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    const res = await POST(
      makeRequest({ type: "REPLY", contextMessageId: "m1" }),
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("generate is rate limited tighter than CRUD (429 passthrough)", async () => {
    await mockAuthed();
    const { rateLimitDraftGeneration } = await import("@/lib/rate-limit");
    vi.mocked(rateLimitDraftGeneration).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });
    const { POST } = await import(
      "@/app/api/mobile/draft-generation/generate/route"
    );
    const res = await POST(
      makeRequest({ type: "REPLY", contextMessageId: "m1" }),
    );
    expect(res.status).toBe(429);
  });
});
