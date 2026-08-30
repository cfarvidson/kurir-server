/**
 * The compose assistant seam (#133): what an instruction and a tone put in
 * front of the adapter, which delivery mode the caller gets, and that panel
 * mode never touches the Draft row. Facts only — no assertions on wording.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import { generateDraftForUser } from "@/lib/draft-generation/generate";
import { BODY_DELIMITER } from "@/lib/draft-generation/prompt";
import { MAX_TOOL_CALLS } from "@/lib/draft-generation/tools";
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
  emailConnectionId: "conn-1",
};

const stubAdapter = (text = "Generated body"): InferenceAdapter =>
  vi.fn(async () => text);

const reply = (extra: Record<string, unknown> = {}) => ({
  type: "REPLY" as const,
  contextMessageId: "msg-1",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
    provider: "claudeCode",
    encryptedSecret: encrypt("sk-ant-oat01-test"),
  } as never);
  vi.mocked(db.emailConnection.findMany).mockResolvedValue([
    { email: "me@own.io", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
  ] as never);
  vi.mocked(db.message.findFirst).mockResolvedValue(contextMessage as never);
  vi.mocked(db.message.findMany).mockResolvedValue([] as never);
  vi.mocked(db.draft.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.draft.upsert).mockImplementation(((args: {
    create: Record<string, unknown>;
  }) => Promise.resolve({ id: "d1", ...args.create })) as never);
});

describe("panel mode", () => {
  it("returns the body to the caller and leaves the Draft row alone", async () => {
    const result = await generateDraftForUser(
      "user-1",
      reply({ instruction: "Say Thursday works" }),
      stubAdapter("Thursday works for me."),
    );

    expect(result).toEqual({ mode: "panel", body: "Thursday works for me." });
    expect(db.draft.upsert).not.toHaveBeenCalled();
    expect(db.draft.findUnique).not.toHaveBeenCalled();
  });

  it("an empty instruction is still panel mode — the field is the switch", async () => {
    const result = await generateDraftForUser(
      "user-1",
      reply({ instruction: "" }),
      stubAdapter("Inferred body"),
    );
    expect(result).toEqual({ mode: "panel", body: "Inferred body" });
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });

  it("no instruction field keeps the old contract: the Draft row is upserted", async () => {
    const result = await generateDraftForUser(
      "user-1",
      reply(),
      stubAdapter("One-tap body"),
    );
    expect(result).toMatchObject({ mode: "draft" });
    expect(db.draft.upsert).toHaveBeenCalled();
  });

  it("generates over an existing typed body without a BODY_EXISTS conflict", async () => {
    vi.mocked(db.draft.findUnique).mockResolvedValue({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "I typed this myself",
      emailConnectionId: null,
      attachmentIds: [],
    } as never);

    const result = await generateDraftForUser(
      "user-1",
      reply({ instruction: "Redo it" }),
      stubAdapter("A version"),
    );
    expect(result).toMatchObject({ mode: "panel", body: "A version" });
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });
});

describe("what the adapter is handed", () => {
  it("carries the instruction and offers the bounded mailbox tools", async () => {
    const adapter = stubAdapter();
    await generateDraftForUser(
      "user-1",
      reply({ instruction: "Say I cannot make Tuesday, offer Thursday" }),
      adapter,
    );

    const { request } = vi.mocked(adapter).mock.calls[0][0];
    expect(request.user).toContain("Say I cannot make Tuesday, offer Thursday");
    expect(request.tools?.map((t) => t.name)).toEqual([
      "search_mail",
      "read_message",
    ]);
    expect(request.maxToolCalls).toBe(MAX_TOOL_CALLS);
  });

  it("offers no tools on the one-tap path", async () => {
    const adapter = stubAdapter();
    await generateDraftForUser("user-1", reply(), adapter);
    expect(vi.mocked(adapter).mock.calls[0][0].request.tools).toBeUndefined();
  });

  it("offers no tools for an empty instruction — that is one-tap reproduced", async () => {
    const adapter = stubAdapter();
    await generateDraftForUser("user-1", reply({ instruction: "  " }), adapter);
    expect(vi.mocked(adapter).mock.calls[0][0].request.tools).toBeUndefined();
  });

  it("new mail is a new mail to the correspondent, not an answer to a latest mail", async () => {
    const newAdapter = stubAdapter();
    await generateDraftForUser(
      "user-1",
      { type: "NEW", contextMessageId: "new-1", to: "ada@x.y", instruction: "hi" },
      newAdapter,
    );
    const replyAdapter = stubAdapter();
    await generateDraftForUser("user-1", reply({ instruction: "hi" }), replyAdapter);

    const newSystem = vi.mocked(newAdapter).mock.calls[0][0].request.system;
    const replySystem = vi.mocked(replyAdapter).mock.calls[0][0].request.system;
    expect(newSystem).toContain("This is a new mail, not a reply");
    expect(newSystem).not.toContain("You draft email replies");
    expect(newSystem).not.toContain("answers the latest mail");
    expect(replySystem).toContain("You draft email replies");
    expect(replySystem).toContain("answers the latest mail");
  });

  it("NEW and REPLY system prompts both carry the unslop constraints", async () => {
    const newAdapter = stubAdapter();
    await generateDraftForUser(
      "user-1",
      { type: "NEW", contextMessageId: "new-1", to: "ada@x.y", instruction: "hi" },
      newAdapter,
    );
    const replyAdapter = stubAdapter();
    await generateDraftForUser("user-1", reply({ instruction: "hi" }), replyAdapter);

    for (const system of [
      vi.mocked(newAdapter).mock.calls[0][0].request.system,
      vi.mocked(replyAdapter).mock.calls[0][0].request.system,
    ]) {
      expect(system).toContain("Not a template, not a press release");
      expect(system).toContain("pivotal");
      expect(system).toContain("vibrant");
      expect(system).toContain("groundbreaking");
      expect(system).toContain("testament");
      expect(system).toContain("landscape");
      expect(system).toContain("delve");
      expect(system).toContain("showcase");
      expect(system).toContain("underscore");
      expect(system).toContain("Not just X, but Y");
      expect(system).toContain("em dashes");
      expect(system).toContain("I hope this helps!");
      expect(system).toContain("Let me know if you have any questions");
      expect(system).toContain("Of course!");
      expect(system).toContain("Certainly!");
      expect(system).toContain("In order to");
      expect(system).toContain("It is important to note that");
      expect(system).toContain("Vary sentence length");
      expect(system).toContain("First person");
    }
  });

  it("each tone produces a different system prompt; auto is the default", async () => {
    const systems = new Map<string, string>();
    for (const tone of ["auto", "formal", "friendly", "direct"] as const) {
      const adapter = stubAdapter();
      await generateDraftForUser(
        "user-1",
        reply({ instruction: "hi", tone }),
        adapter,
      );
      systems.set(tone, vi.mocked(adapter).mock.calls[0][0].request.system);
    }
    expect(new Set(systems.values()).size).toBe(4);

    const adapter = stubAdapter();
    await generateDraftForUser("user-1", reply({ instruction: "hi" }), adapter);
    expect(vi.mocked(adapter).mock.calls[0][0].request.system).toBe(
      systems.get("auto"),
    );
  });

  it("caps how long an instruction may be", async () => {
    const { generateDraftSchema, MAX_INSTRUCTION_CHARS } = await import(
      "@/lib/draft-generation/generate"
    );
    const parsed = generateDraftSchema.safeParse({
      type: "REPLY",
      contextMessageId: "msg-1",
      instruction: "x".repeat(MAX_INSTRUCTION_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("subject for new mail", () => {
  const newMail = (extra: Record<string, unknown> = {}) => ({
    type: "NEW" as const,
    contextMessageId: "new-1",
    to: "ada@x.y",
    ...extra,
  });

  it("parses a proposed subject out of the delimited answer", async () => {
    const result = await generateDraftForUser(
      "user-1",
      newMail({ instruction: "Ask about the March invoice" }),
      stubAdapter(`SUBJECT: The March invoice\n${BODY_DELIMITER}\nHi Ada,\n\nAbout March…`),
    );
    expect(result).toEqual({
      mode: "panel",
      subject: "The March invoice",
      body: "Hi Ada,\n\nAbout March…",
    });
  });

  it("a subject line without the delimiter is still taken off the body", async () => {
    const result = await generateDraftForUser(
      "user-1",
      newMail({ instruction: "Ask about the March invoice" }),
      stubAdapter("SUBJECT: The March invoice\nHi Ada,\n\nAbout March…"),
    );
    expect(result).toEqual({
      mode: "panel",
      subject: "The March invoice",
      body: "Hi Ada,\n\nAbout March…",
    });
  });

  it("a subject line with nothing after it stays a body, never an empty draft", async () => {
    const result = await generateDraftForUser(
      "user-1",
      newMail({ instruction: "Ask about the March invoice" }),
      stubAdapter("SUBJECT: The March invoice"),
    );
    expect(result).toEqual({ mode: "panel", body: "SUBJECT: The March invoice" });
  });

  it("an answer that ignores the protocol degrades to body-only", async () => {
    const result = await generateDraftForUser(
      "user-1",
      newMail({ instruction: "Ask about the March invoice" }),
      stubAdapter("Hi Ada, about March…"),
    );
    expect(result).toEqual({ mode: "panel", body: "Hi Ada, about March…" });
  });

  it("replies are never asked for a subject", async () => {
    const adapter = stubAdapter();
    await generateDraftForUser("user-1", reply({ instruction: "hi" }), adapter);
    expect(vi.mocked(adapter).mock.calls[0][0].request.system).not.toContain(
      BODY_DELIMITER,
    );
  });

  it("asks for a subject only on panel NEW, never on one-tap NEW", async () => {
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
                textBody: "Earlier note from Ada",
                htmlBody: null,
              },
            ],
      )) as never);

    const panel = stubAdapter();
    await generateDraftForUser(
      "user-1",
      newMail({ instruction: "Ask about March" }),
      panel,
    );
    expect(vi.mocked(panel).mock.calls[0][0].request.system).toContain(
      BODY_DELIMITER,
    );

    const oneTap = stubAdapter();
    await generateDraftForUser("user-1", newMail(), oneTap);
    expect(vi.mocked(oneTap).mock.calls[0][0].request.system).not.toContain(
      BODY_DELIMITER,
    );
  });
});
