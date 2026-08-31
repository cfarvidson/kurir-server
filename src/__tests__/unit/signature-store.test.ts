import { describe, it, expect, vi, beforeEach } from "vitest";

const senderFindMany = vi.fn();
const senderUpdate = vi.fn();
const messageFindMany = vi.fn();
const connectionFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    sender: {
      findMany: (...args: unknown[]) => senderFindMany(...args),
      update: (...args: unknown[]) => senderUpdate(...args),
    },
    message: { findMany: (...args: unknown[]) => messageFindMany(...args) },
    emailConnection: {
      findMany: (...args: unknown[]) => connectionFindMany(...args),
    },
  },
}));

import {
  backfillSignatures,
  foldSignature,
  kickSignatureBackfill,
  recordSenderSignature,
  resetSignatureBackfillKicks,
} from "@/lib/mail/signature-store";

const SIG = [
  "Hej",
  "",
  "Mvh",
  "Anna Andersson",
  "Ekonomichef",
  "Acme AB",
  "Mobil: 070-123 45 67",
].join("\n");

function sender(over: Partial<Parameters<typeof foldSignature>[0]> = {}) {
  return {
    id: "s1",
    signaturePhones: [],
    signatureTitle: null,
    signatureCompany: null,
    signatureExtractedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSignatureBackfillKicks();
  connectionFindMany.mockResolvedValue([
    { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
  ]);
});

describe("foldSignature", () => {
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-08-01T00:00:00Z");

  it("lets a newer body overwrite and moves the stamp forward", () => {
    const folded = foldSignature(
      sender({ signatureTitle: "Old title", signatureExtractedAt: older }),
      { phones: [], title: "New title", company: undefined },
      newer,
    );
    expect(folded.details.title).toBe("New title");
    expect(folded.extractedAt).toBe(newer);
  });

  it("lets an older body only fill gaps and keeps the stamp", () => {
    const folded = foldSignature(
      sender({ signatureTitle: "Current", signatureExtractedAt: newer }),
      { phones: ["070-1"], title: "Stale", company: "Acme AB" },
      older,
    );
    expect(folded.details).toEqual({
      phones: ["070-1"],
      title: "Current",
      company: "Acme AB",
    });
    expect(folded.extractedAt).toBe(newer);
  });
});

describe("recordSenderSignature", () => {
  it("stores what the body's signature carries", async () => {
    senderUpdate.mockResolvedValue({});
    const at = new Date("2026-08-30T10:00:00Z");
    await recordSenderSignature(sender(), SIG, at);
    expect(senderUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: {
        signaturePhones: ["070-123 45 67"],
        signatureTitle: "Ekonomichef",
        signatureCompany: "Acme AB",
        signatureExtractedAt: at,
      },
    });
  });

  it("never throws into the sync", async () => {
    senderUpdate.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordSenderSignature(sender(), SIG, new Date()),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("backfillSignatures", () => {
  it("scans unprocessed senders over their newest bodies, newest winning", async () => {
    senderFindMany
      .mockResolvedValueOnce([
        { ...sender(), email: "anna@acme.se" },
        { ...sender({ id: "own" }), email: "me@example.com" },
      ])
      .mockResolvedValueOnce([]);
    const t1 = new Date("2026-08-30T10:00:00Z");
    const t0 = new Date("2026-01-30T10:00:00Z");
    messageFindMany.mockResolvedValue([
      { textBody: SIG, receivedAt: t1 },
      {
        textBody: "Hej\n\nMvh\nAnna\nJunior Controller\nAcme AB\nTel: 08-111 22 33",
        receivedAt: t0,
      },
    ]);
    senderUpdate.mockResolvedValue({});

    const processed = await backfillSignatures("u1", { pauseMs: 0 });

    expect(processed).toBe(2);
    expect(senderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", signatureExtractedAt: null },
      }),
    );
    // The external sender: newest title wins, phones unioned newest first.
    expect(senderUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: {
        signaturePhones: ["070-123 45 67", "08-111 22 33"],
        signatureTitle: "Ekonomichef",
        signatureCompany: "Acme AB",
        signatureExtractedAt: t1,
      },
    });
    // The user's own sender is stamped without reading any body.
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(senderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "own" },
        data: expect.objectContaining({ signaturePhones: [], signatureTitle: null }),
      }),
    );
  });

  it("stops when a batch comes back short", async () => {
    senderFindMany.mockResolvedValueOnce([]);
    expect(await backfillSignatures("u1")).toBe(0);
    expect(senderFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("kickSignatureBackfill", () => {
  it("runs once per user per process and returns synchronously", async () => {
    senderFindMany.mockResolvedValue([]);
    kickSignatureBackfill("u1");
    kickSignatureBackfill("u1");
    kickSignatureBackfill("u2");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // One own-address lookup per started backfill.
    expect(connectionFindMany).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after a failure", async () => {
    connectionFindMany.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    kickSignatureBackfill("u1");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    senderFindMany.mockResolvedValue([]);
    kickSignatureBackfill("u1");
    await new Promise((r) => setTimeout(r, 0));
    expect(connectionFindMany).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
