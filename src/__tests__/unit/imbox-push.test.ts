/**
 * New-Imbox-mail pushes: mail an AI content rule will judge is held until the
 * evaluation run has finished and pushed only if it is still in the Imbox;
 * everything else pushes at once. Runs through the real kicker.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import {
  pushNewImboxMessages,
  resetHeldPushes,
} from "@/lib/mail/imbox-push";
import { resetContentRuleKicks } from "@/lib/mail/content-rule-store";

vi.mock("@/lib/db", () => ({
  db: {
    contentRule: { findMany: vi.fn(), findUnique: vi.fn() },
    contentRuleMatch: { upsert: vi.fn() },
    message: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    draftGenerationCredential: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/mail/archive-imap", () => ({ moveToArchiveViaImap: vi.fn() }));
vi.mock("@/lib/mail/sse-subscribers", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/mail/push-sender", () => ({
  pushToUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/draft-generation/providers", () => ({
  defaultInferenceAdapter: vi.fn(async () => '{"match": false}'),
}));

import { db } from "@/lib/db";
import { pushToUser } from "@/lib/mail/push-sender";

const updatedAt = new Date("2026-09-01T00:00:00Z");
const rule = {
  id: "rule-1",
  criterion: "2 dagar remote i Uppsala",
  onMatch: "IMBOX",
  onNoMatch: "ARCHIVE",
  emailConnectionId: null,
  updatedAt,
  senders: [
    {
      scope: "DOMAIN",
      scopeValue: "consult.se",
      since: new Date("2026-08-02T00:00:00Z"),
    },
  ],
};

const pushMessage = {
  id: "m-1",
  fromName: "Anna",
  fromAddress: "anna@consult.se",
  subject: "Nytt uppdrag",
  threadId: "t-1",
};
const row = {
  ...pushMessage,
  uid: 100,
  folderId: "folder-inbox",
  emailConnectionId: "conn-1",
  receivedAt: new Date("2026-09-10T00:00:00Z"),
  textBody: "body",
  htmlBody: null,
};

/** Route message.findMany by caller: candidates, release, or coverage rows. */
function mockMessages(stillInImbox: boolean) {
  vi.mocked(db.message.findMany).mockImplementation(((args: {
    where: { isInImbox?: boolean };
    select: { textBody?: boolean };
  }) => {
    if (args.where.isInImbox) return Promise.resolve(stillInImbox ? [row] : []);
    return Promise.resolve([row]);
  }) as never);
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetContentRuleKicks();
  resetHeldPushes();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(db.contentRuleMatch.upsert).mockResolvedValue({} as never);
  vi.mocked(db.message.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.contentRule.findUnique).mockResolvedValue({
    updatedAt,
  } as never);
  vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
    provider: "claudeCode",
    encryptedSecret: encrypt("sk-ant-oat01-test"),
  } as never);
});

describe("pushNewImboxMessages", () => {
  it("pushes at once when no AI rule covers the sender", async () => {
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { ...row, fromAddress: "bo@other.se" },
    ] as never);

    await pushNewImboxMessages("u1", [
      { ...pushMessage, fromAddress: "bo@other.se" },
    ]);

    expect(pushToUser).toHaveBeenCalledTimes(1);
    expect(db.contentRuleMatch.upsert).not.toHaveBeenCalled();
  });

  it("holds the push until the rule has judged, and drops it when the rule filed the mail away", async () => {
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    mockMessages(false);

    await pushNewImboxMessages("u1", [pushMessage]);
    expect(pushToUser).not.toHaveBeenCalled();

    await settle();
    expect(db.contentRuleMatch.upsert).toHaveBeenCalledTimes(1);
    expect(pushToUser).not.toHaveBeenCalled();
  });

  it("pushes after the run when the mail is still in the Imbox, even if the run failed", async () => {
    vi.mocked(db.contentRule.findMany).mockResolvedValue([rule] as never);
    mockMessages(true);
    vi.mocked(db.draftGenerationCredential.findUnique).mockRejectedValue(
      new Error("db down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await pushNewImboxMessages("u1", [pushMessage]);
    expect(pushToUser).not.toHaveBeenCalled();

    await settle();
    expect(pushToUser).toHaveBeenCalledTimes(1);
    expect(pushToUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ url: "/imbox/m-1", tag: "t-1" }),
    );
    errorSpy.mockRestore();
  });
});
