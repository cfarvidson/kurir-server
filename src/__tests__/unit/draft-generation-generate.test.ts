/**
 * The generate orchestration: context enters the prompt, the stub adapter's
 * text lands on the Draft row through the existing saver, conflicts guard
 * typed bodies, and typed errors come out for every refusal path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import { generateDraftForUser } from "@/lib/draft-generation/generate";
import type { InferenceAdapter } from "@/lib/draft-generation/types";

vi.mock("@/lib/db", () => ({
  db: {
    draft: { findUnique: vi.fn(), upsert: vi.fn() },
    message: { findFirst: vi.fn(), findMany: vi.fn() },
    emailConnection: { findMany: vi.fn() },
    attachment: { count: vi.fn() },
    draftGenerationCredential: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/demo", () => ({ isDemoInstance: vi.fn(() => false) }));

import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";

const contextMessage = {
  id: "msg-1",
  subject: "Lunch on Thursday?",
  fromAddress: "ada@x.y",
  fromName: "Ada",
  replyTo: null,
  toAddresses: ["me@own.io"],
  receivedAt: new Date("2026-08-25T09:00:00Z"),
  textBody: "Does Thursday at noon work for lunch?",
  htmlBody: null,
  isInImbox: true,
  isInFeed: false,
  isInPaperTrail: false,
  isArchived: false,
  emailConnectionId: "conn-1",
};

function mockCredential() {
  vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
    provider: "claudeCode",
    encryptedSecret: encrypt("sk-ant-oat01-test"),
  } as never);
}

function mockOwnConnections() {
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([
    {
      email: "me@own.io",
      sendAsEmail: null,
      aliases: [],
      treatDomainAsOwn: false,
    },
  ] as never);
}

const stubAdapter = (text = "Generated reply body"): InferenceAdapter =>
  vi.fn(async () => text);

describe("generateDraftForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
    mockCredential();
    mockOwnConnections();
    vi.mocked(db.message.findFirst).mockResolvedValue(contextMessage as never);
    vi.mocked(db.message.findMany).mockImplementation(((args: {
      where: { OR?: unknown };
    }) =>
      Promise.resolve(
        args.where.OR
          ? []
          : [
              {
                subject: "Last week",
                receivedAt: new Date("2026-08-20T00:00:00Z"),
                textBody: "Earlier note from Ada about the project",
                htmlBody: null,
              },
            ],
      )) as never);
    vi.mocked(db.draft.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.draft.upsert).mockImplementation(((args: {
      create: Record<string, unknown>;
    }) => Promise.resolve({ id: "d1", ...args.create })) as never);
  });

  it("sends the current mail and prior correspondent mail to the adapter and stores exactly its text", async () => {
    const adapter = stubAdapter("Sure — Thursday works. See you at noon!");
    const result = await generateDraftForUser(
      "user-1",
      { type: "REPLY", contextMessageId: "msg-1" },
      adapter,
    );

    const request = vi.mocked(adapter).mock.calls[0][0].request;
    expect(request.user).toContain("Lunch on Thursday?");
    expect(request.user).toContain("Does Thursday at noon work for lunch?");
    expect(request.user).toContain("Earlier note from Ada about the project");

    const upsert = vi.mocked(db.draft.upsert).mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(upsert.create.body).toBe("Sure — Thursday works. See you at noon!");
    expect(result).toMatchObject({
      mode: "draft",
      draft: { body: "Sure — Thursday works. See you at noon!" },
    });
  });

  it("fills to and subject for a missing REPLY row from the reply conventions", async () => {
    await generateDraftForUser(
      "user-1",
      { type: "REPLY", contextMessageId: "msg-1" },
      stubAdapter(),
    );
    const upsert = vi.mocked(db.draft.upsert).mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(upsert.create.to).toBe("ada@x.y");
    expect(upsert.create.subject).toBe("Lunch on Thursday?");
    expect(upsert.create.emailConnectionId).toBe("conn-1");
  });

  it("keeps existing headers and attachments and only replaces the body", async () => {
    vi.mocked(db.draft.findUnique).mockResolvedValue({
      to: "kept@x.y",
      cc: "cc@x.y",
      bcc: "",
      subject: "Kept subject",
      body: "typed already",
      emailConnectionId: "conn-2",
      attachmentIds: ["att-1"],
    } as never);
    vi.mocked(db.attachment.count).mockResolvedValue(1 as never);

    await generateDraftForUser(
      "user-1",
      { type: "REPLY", contextMessageId: "msg-1", replace: true },
      stubAdapter("new body"),
    );

    const upsert = vi.mocked(db.draft.upsert).mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsert.update).toMatchObject({
      to: "kept@x.y",
      cc: "cc@x.y",
      subject: "Kept subject",
      body: "new body",
      emailConnectionId: "conn-2",
      attachmentIds: ["att-1"],
    });
  });

  it("refuses to overwrite a non-empty body without replace and leaves the draft unchanged", async () => {
    vi.mocked(db.draft.findUnique).mockResolvedValue({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "I typed this myself",
      emailConnectionId: null,
      attachmentIds: [],
    } as never);
    const adapter = stubAdapter();

    await expect(
      generateDraftForUser(
        "user-1",
        { type: "REPLY", contextMessageId: "msg-1" },
        adapter,
      ),
    ).rejects.toMatchObject({ code: "BODY_EXISTS" });
    expect(adapter).not.toHaveBeenCalled();
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("an existing empty-body draft is filled without replace", async () => {
    vi.mocked(db.draft.findUnique).mockResolvedValue({
      to: "ada@x.y",
      cc: "",
      bcc: "",
      subject: "Lunch on Thursday?",
      body: "  ",
      emailConnectionId: null,
      attachmentIds: [],
    } as never);
    await generateDraftForUser(
      "user-1",
      { type: "REPLY", contextMessageId: "msg-1" },
      stubAdapter("filled"),
    );
    const upsert = vi.mocked(db.draft.upsert).mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsert.update.body).toBe("filled");
  });

  it("NEW uses prior correspondence with the first To address", async () => {
    const adapter = stubAdapter();
    await generateDraftForUser(
      "user-1",
      { type: "NEW", contextMessageId: "uuid-1", to: "ada@x.y, bob@x.y" },
      adapter,
    );
    const request = vi.mocked(adapter).mock.calls[0][0].request;
    expect(request.user).toContain("ada@x.y");
    const upsert = vi.mocked(db.draft.upsert).mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(upsert.create.to).toBe("ada@x.y, bob@x.y");
    expect(upsert.create.contextMessageId).toBe("uuid-1");
  });

  it("NEW with an empty To refuses with NO_CORRESPONDENT", async () => {
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "NEW", contextMessageId: "uuid-1", to: " " },
        stubAdapter(),
      ),
    ).rejects.toMatchObject({ code: "NO_CORRESPONDENT" });
  });

  it("NEW with an empty instruction and prior correspondence still generates", async () => {
    const adapter = stubAdapter("Inferred new mail");
    const result = await generateDraftForUser(
      "user-1",
      {
        type: "NEW",
        contextMessageId: "uuid-1",
        to: "ada@x.y",
        instruction: "",
      },
      adapter,
    );
    expect(adapter).toHaveBeenCalled();
    expect(result).toEqual({ mode: "panel", body: "Inferred new mail" });
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("NEW with an empty instruction and no prior correspondence refuses with NOTHING_TO_INFER", async () => {
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const adapter = stubAdapter();
    await expect(
      generateDraftForUser(
        "user-1",
        {
          type: "NEW",
          contextMessageId: "uuid-1",
          to: "ada@x.y",
          instruction: "",
        },
        adapter,
      ),
    ).rejects.toMatchObject({ code: "NOTHING_TO_INFER" });
    expect(adapter).not.toHaveBeenCalled();
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("one-tap NEW with no prior correspondence refuses and leaves the Draft row alone", async () => {
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const adapter = stubAdapter();
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "NEW", contextMessageId: "uuid-1", to: "ada@x.y" },
        adapter,
      ),
    ).rejects.toMatchObject({ code: "NOTHING_TO_INFER" });
    expect(adapter).not.toHaveBeenCalled();
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("NEW with an instruction and no prior correspondence still generates", async () => {
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const adapter = stubAdapter("Asked-for body");
    const result = await generateDraftForUser(
      "user-1",
      {
        type: "NEW",
        contextMessageId: "uuid-1",
        to: "ada@x.y",
        instruction: "Ask about the March invoice",
      },
      adapter,
    );
    expect(result).toEqual({ mode: "panel", body: "Asked-for body" });
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("NEW treats the user's own sent mail as prior correspondence", async () => {
    vi.mocked(db.message.findMany).mockImplementation(((args: {
      where: { OR?: unknown };
    }) =>
      Promise.resolve(
        args.where.OR
          ? [
              {
                subject: "My last note",
                receivedAt: new Date("2026-08-20T00:00:00Z"),
                textBody: "Thanks for lunch last week",
                htmlBody: null,
                toAddresses: ["ada@x.y"],
              },
            ]
          : [],
      )) as never);
    const adapter = stubAdapter("Inferred from own sent");
    const result = await generateDraftForUser(
      "user-1",
      {
        type: "NEW",
        contextMessageId: "uuid-1",
        to: "ada@x.y",
        instruction: "",
      },
      adapter,
    );
    expect(result).toEqual({ mode: "panel", body: "Inferred from own sent" });
  });

  it("FORWARD refuses with UNSUPPORTED_TYPE", async () => {
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "FORWARD", contextMessageId: "msg-1" },
        stubAdapter(),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });

  it("no stored credential refuses with NO_CREDENTIAL", async () => {
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue(
      null as never,
    );
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "REPLY", contextMessageId: "msg-1" },
        stubAdapter(),
      ),
    ).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });

  it("demo instance refuses before touching the credential or the adapter", async () => {
    vi.mocked(isDemoInstance).mockReturnValue(true);
    const adapter = stubAdapter();
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "REPLY", contextMessageId: "msg-1" },
        adapter,
      ),
    ).rejects.toMatchObject({ code: "DEMO_INSTANCE" });
    expect(db.draftGenerationCredential.findUnique).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it("a missing context message refuses with CONTEXT_MESSAGE_MISSING", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null as never);
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "REPLY", contextMessageId: "gone" },
        stubAdapter(),
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_MESSAGE_MISSING" });
  });

  it("adapter errors (dead token, usage limit) pass through typed", async () => {
    const { DraftGenerationError } = await import(
      "@/lib/draft-generation/types"
    );
    const adapter: InferenceAdapter = async () => {
      throw new DraftGenerationError("USAGE_LIMITED", "window exhausted");
    };
    await expect(
      generateDraftForUser(
        "user-1",
        { type: "REPLY", contextMessageId: "msg-1" },
        adapter,
      ),
    ).rejects.toMatchObject({ code: "USAGE_LIMITED" });
  });

  it("unrelated senders never enter the prompt (query is scoped to the correspondent)", async () => {
    await generateDraftForUser(
      "user-1",
      { type: "REPLY", contextMessageId: "msg-1" },
      stubAdapter(),
    );
    const fromCall = vi
      .mocked(db.message.findMany)
      .mock.calls.map((c) => c[0] as { where: Record<string, unknown> })
      .find((c) => "fromAddress" in c.where)!;
    expect(fromCall.where.fromAddress).toEqual({
      equals: "ada@x.y",
      mode: "insensitive",
    });
    expect(fromCall.where.userId).toBe("user-1");
  });
});
