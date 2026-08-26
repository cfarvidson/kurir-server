/**
 * The settings backup payload must never carry the draft-generation secret:
 * the snapshot builder never reads the credential table, and the serialized
 * JSON contains no token even when one is stored for the user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    emailConnection: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    contactGroup: { findMany: vi.fn() },
    sender: { findMany: vi.fn() },
    domainRule: { findMany: vi.fn() },
    subjectRule: { findMany: vi.fn() },
    draftGenerationCredential: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/mail/persist-sent", () => ({
  createLocalSentMessage: vi.fn(),
  appendToImapSent: vi.fn(),
  getSentFolder: vi.fn(),
}));

vi.mock("@/lib/mail/mutations", () => ({
  approveSenderForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  withImapConnection: vi.fn(),
}));

vi.mock("@/lib/mail/tombstones", () => ({
  deleteMessagesWithTombstones: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/mail/domain-rules", () => ({
  patternMatchesDomain: vi.fn(() => false),
}));

import { db } from "@/lib/db";
import { snapshotSettingsForUser } from "@/lib/mail/settings-backup";
import { serializeSettingsBackup } from "@/lib/mail/settings-backup-payload";

describe("settings backup vs draft-generation credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      theme: "dark",
      timezone: "UTC",
      blockRemoteImages: false,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    } as never);
    vi.mocked(db.emailConnection.findMany).mockResolvedValue([] as never);
    vi.mocked(db.contact.findMany).mockResolvedValue([] as never);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([] as never);
    vi.mocked(db.sender.findMany).mockResolvedValue([] as never);
    vi.mocked(db.domainRule.findMany).mockResolvedValue([] as never);
    vi.mocked(db.subjectRule.findMany).mockResolvedValue([] as never);
    // A stored credential exists — the snapshot must neither read nor leak it.
    vi.mocked(db.draftGenerationCredential.findUnique).mockResolvedValue({
      provider: "claudeCode",
      encryptedSecret: "iv:tag:sk-ant-oat01-would-be-a-leak",
    } as never);
  });

  it("the snapshot never queries the credential table and the JSON has no token", async () => {
    const snapshot = await snapshotSettingsForUser("user-1", "manual");
    const serialized = serializeSettingsBackup(snapshot);

    expect(db.draftGenerationCredential.findUnique).not.toHaveBeenCalled();
    expect(serialized).not.toContain("sk-ant-oat");
    expect(serialized).not.toContain("draftGeneration");
    expect(serialized).not.toContain("encryptedSecret");
  });
});
