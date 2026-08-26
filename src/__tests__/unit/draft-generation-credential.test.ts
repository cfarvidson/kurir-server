/**
 * Credential intake and storage for draft generation: subscription tokens
 * accepted, pay-per-token API keys refused, ciphertext at rest, status
 * without the secret, demo-instance refusal before any write.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decrypt } from "@/lib/crypto";
import {
  classifyDraftGenerationToken,
  getDraftGenerationStatus,
  loadDraftGenerationSecret,
  removeDraftGenerationCredential,
  rotateDraftGenerationSecret,
  saveDraftGenerationCredential,
} from "@/lib/draft-generation/credential";
import { parseGrokSession } from "@/lib/draft-generation/grok-session";
import { DraftGenerationError } from "@/lib/draft-generation/types";

vi.mock("@/lib/db", () => ({
  db: {
    draftGenerationCredential: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/demo", () => ({ isDemoInstance: vi.fn(() => false) }));

import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";

const SETUP_TOKEN = "sk-ant-oat01-abcdef1234567890";
const GROK_AUTH_JSON = JSON.stringify({
  access_token: "grok-access-1",
  refresh_token: "grok-refresh-1",
});

describe("classifyDraftGenerationToken", () => {
  it("accepts a Claude Code setup-token", () => {
    expect(classifyDraftGenerationToken("claudeCode", ` ${SETUP_TOKEN} `)).toBe(
      SETUP_TOKEN,
    );
  });

  it("rejects an Anthropic Console API key with a clear message", () => {
    expect(() =>
      classifyDraftGenerationToken("claudeCode", "sk-ant-api03-metered"),
    ).toThrowError(/setup-token/);
    try {
      classifyDraftGenerationToken("claudeCode", "sk-ant-api03-metered");
    } catch (error) {
      expect((error as DraftGenerationError).code).toBe("TOKEN_REJECTED");
    }
  });

  it("rejects an xAI API key even for the grokBuild provider", () => {
    expect(() =>
      classifyDraftGenerationToken("grokBuild", "xai-abc123"),
    ).toThrowError(/xAI API key/);
  });

  it("rejects an empty paste", () => {
    expect(() => classifyDraftGenerationToken("claudeCode", "  ")).toThrowError(
      /Paste a token/,
    );
  });

  it("rejects a random string as a Claude token", () => {
    expect(() =>
      classifyDraftGenerationToken("claudeCode", "hunter2"),
    ).toThrowError(/setup-token/);
  });

  it("accepts and normalizes a Grok auth.json session", () => {
    const secret = classifyDraftGenerationToken("grokBuild", GROK_AUTH_JSON);
    expect(parseGrokSession(secret)).toEqual({
      access: "grok-access-1",
      refresh: "grok-refresh-1",
    });
  });

  it("rejects a non-session string as a Grok session", () => {
    expect(() =>
      classifyDraftGenerationToken("grokBuild", "not-json"),
    ).toThrowError(/Grok Build session/);
  });
});

describe("credential storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
  });

  it("save encrypts — the stored ciphertext is not the pasted token but decrypts back to it", async () => {
    const status = await saveDraftGenerationCredential(
      "user-1",
      "claudeCode",
      SETUP_TOKEN,
    );
    expect(status).toEqual({ connected: true, provider: "claudeCode" });
    const call = vi.mocked(db.draftGenerationCredential.upsert).mock
      .calls[0][0] as {
      create: { encryptedSecret: string; provider: string };
    };
    expect(call.create.provider).toBe("claudeCode");
    expect(call.create.encryptedSecret).not.toContain(SETUP_TOKEN);
    expect(decrypt(call.create.encryptedSecret)).toBe(SETUP_TOKEN);
  });

  it("status reports connected + provider and never the secret", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "grokBuild",
    } as never);
    const status = await getDraftGenerationStatus("user-1");
    expect(status).toEqual({ connected: true, provider: "grokBuild" });
    // Status reads select only the provider column — never the ciphertext.
    expect(
      vi.mocked(db.draftGenerationCredential.findUnique).mock.calls[0][0],
    ).toMatchObject({ select: { provider: true } });
  });

  it("status is disconnected without a row", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue(
      null as never,
    );
    expect(await getDraftGenerationStatus("user-1")).toEqual({
      connected: false,
      provider: null,
    });
  });

  it("demo instance refuses save before any classification or write", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);
    await expect(
      saveDraftGenerationCredential("user-1", "claudeCode", SETUP_TOKEN),
    ).rejects.toMatchObject({ code: "DEMO_INSTANCE" });
    expect(db.draftGenerationCredential.upsert).not.toHaveBeenCalled();
  });

  it("remove deletes the row and reports disconnected", async () => {
    vi.mocked(db.draftGenerationCredential.deleteMany).mockResolvedValue({
      count: 1,
    } as never);
    expect(await removeDraftGenerationCredential("user-1")).toEqual({
      connected: false,
      provider: null,
    });
    expect(db.draftGenerationCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("loadDraftGenerationSecret decrypts the stored ciphertext", async () => {
    await saveDraftGenerationCredential("user-1", "claudeCode", SETUP_TOKEN);
    const stored = (
      vi.mocked(db.draftGenerationCredential.upsert).mock.calls[0][0] as {
        create: { encryptedSecret: string };
      }
    ).create.encryptedSecret;
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "claudeCode",
      encryptedSecret: stored,
    } as never);
    expect(await loadDraftGenerationSecret("user-1")).toEqual({
      provider: "claudeCode",
      secret: SETUP_TOKEN,
    });
  });

  it("rotate re-encrypts the new secret in place", async () => {
    await rotateDraftGenerationSecret("user-1", "next-secret");
    const call = vi.mocked(db.draftGenerationCredential.update).mock
      .calls[0][0] as {
      where: { userId: string };
      data: { encryptedSecret: string };
    };
    expect(call.where).toEqual({ userId: "user-1" });
    expect(decrypt(call.data.encryptedSecret)).toBe("next-secret");
  });
});
