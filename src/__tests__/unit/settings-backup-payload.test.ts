import { describe, it, expect } from "vitest";
import {
  parseSettingsBackup,
  serializeSettingsBackup,
  isSettingsBackupMessage,
  settingsBackupFilename,
  settingsBackupSubject,
  backupsToPrune,
  SETTINGS_BACKUP_SUBJECT_PREFIX,
  type SettingsBackupPayload,
} from "@/lib/mail/settings-backup-payload";

function validPayload(
  overrides: Partial<SettingsBackupPayload> = {},
): SettingsBackupPayload {
  return {
    kind: "kurir-settings-backup",
    version: 1,
    exportedAt: "2026-08-17T01:00:00.000Z",
    source: "manual",
    preferences: {
      theme: "system",
      timezone: "Europe/Stockholm",
      blockRemoteImages: true,
      blockTrackers: true,
      showImboxBadge: true,
      showScreenerBadge: true,
      showFeedBadge: true,
      showPaperTrailBadge: true,
      showFollowUpBadge: true,
      showReplyLaterBadge: true,
      showScheduledBadge: true,
    },
    contacts: [
      {
        name: "Ada",
        notes: "",
        emails: [
          { email: "ada@example.com", label: "work", isPrimary: true },
        ],
      },
    ],
    contactGroups: [
      { name: "Family", defaultTarget: "TO", members: ["ada@example.com"] },
    ],
    senders: [
      {
        connectionEmail: "you@gmail.com",
        email: "news@github.com",
        domain: "github.com",
        status: "APPROVED",
        category: "FEED",
        unthread: false,
        allowRemoteImages: false,
      },
    ],
    domainRules: [
      {
        connectionEmail: "you@gmail.com",
        pattern: "github.com",
        includeSubdomains: true,
        status: "APPROVED",
        category: "FEED",
      },
    ],
    ...overrides,
  };
}

describe("parseSettingsBackup", () => {
  it("round-trips a full v1 payload", () => {
    const original = validPayload();
    const parsed = parseSettingsBackup(serializeSettingsBackup(original));
    expect(parsed).toEqual(original);
  });

  it("rejects unknown version", () => {
    expect(() =>
      parseSettingsBackup({ ...validPayload(), version: 2 }),
    ).toThrow(/version/i);
  });

  it("rejects wrong kind", () => {
    expect(() =>
      parseSettingsBackup({ ...validPayload(), kind: "other" }),
    ).toThrow(/kind/i);
  });

  it("rejects a messages key", () => {
    expect(() =>
      parseSettingsBackup({ ...validPayload(), messages: [] }),
    ).toThrow(/messages/i);
  });

  it("rejects threads, drafts, and folders keys", () => {
    expect(() =>
      parseSettingsBackup({ ...validPayload(), threads: [] }),
    ).toThrow();
    expect(() =>
      parseSettingsBackup({ ...validPayload(), drafts: [] }),
    ).toThrow();
    expect(() =>
      parseSettingsBackup({ ...validPayload(), folders: [] }),
    ).toThrow();
  });

  it("rejects invalid JSON strings", () => {
    expect(() => parseSettingsBackup("not-json")).toThrow();
    expect(() => parseSettingsBackup("{")).toThrow();
  });

  it("parses a JSON string", () => {
    const payload = validPayload();
    expect(parseSettingsBackup(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects missing preference fields", () => {
    const base = validPayload();
    expect(() =>
      parseSettingsBackup({
        ...base,
        preferences: { theme: "dark" },
      }),
    ).toThrow(/invalid settings backup/i);
  });

  it("rejects an unknown theme", () => {
    expect(() =>
      parseSettingsBackup({
        ...validPayload(),
        preferences: {
          ...validPayload().preferences,
          theme: "solarized",
        },
      }),
    ).toThrow(/theme/i);
  });

  it("rejects a PENDING sender status", () => {
    expect(() =>
      parseSettingsBackup({
        ...validPayload(),
        senders: [
          {
            ...validPayload().senders[0],
            status: "PENDING",
          },
        ],
      }),
    ).toThrow(/status/i);
  });

  it("rejects an approved sender without a category", () => {
    expect(() =>
      parseSettingsBackup({
        ...validPayload(),
        senders: [
          {
            ...validPayload().senders[0],
            status: "APPROVED",
            category: null,
          },
        ],
      }),
    ).toThrow(/category/i);
  });

  it("normalizes emails to lowercase", () => {
    const parsed = parseSettingsBackup({
      ...validPayload(),
      senders: [
        {
          ...validPayload().senders[0],
          connectionEmail: "You@Gmail.com",
          email: "News@GitHub.com",
        },
      ],
    });
    expect(parsed.senders[0].connectionEmail).toBe("you@gmail.com");
    expect(parsed.senders[0].email).toBe("news@github.com");
  });
});

describe("isSettingsBackupMessage", () => {
  it("accepts the subject prefix plus kurir-settings json filename", () => {
    expect(
      isSettingsBackupMessage(
        `${SETTINGS_BACKUP_SUBJECT_PREFIX}17 Aug 2026`,
        ["kurir-settings-2026-08-17.json"],
      ),
    ).toBe(true);
  });

  it("ignores ordinary Sent mail", () => {
    expect(
      isSettingsBackupMessage("Re: lunch", ["invoice.pdf"]),
    ).toBe(false);
    expect(
      isSettingsBackupMessage(
        `${SETTINGS_BACKUP_SUBJECT_PREFIX}17 Aug 2026`,
        ["notes.txt"],
      ),
    ).toBe(false);
    expect(
      isSettingsBackupMessage("Hello", ["kurir-settings-2026-08-17.json"]),
    ).toBe(false);
  });
});

describe("backupsToPrune", () => {
  it("keeps the 4 newest by sentAt and returns the rest", () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: String(n),
      sentAt: new Date(2026, 7, n),
    }));
    expect(backupsToPrune(items).map((b) => b.id)).toEqual(["2", "1"]);
  });

  it("returns nothing when there are 4 or fewer", () => {
    const items = [1, 2].map((n) => ({
      id: String(n),
      sentAt: new Date(2026, 7, n),
    }));
    expect(backupsToPrune(items)).toEqual([]);
  });
});

describe("settingsBackupFilename and subject", () => {
  it("names the file with the local calendar day", () => {
    // 2026-08-17 01:00 UTC is still 17 Aug in Stockholm (UTC+2)
    const date = new Date("2026-08-17T01:00:00.000Z");
    expect(settingsBackupFilename(date, "Europe/Stockholm")).toBe(
      "kurir-settings-2026-08-17.json",
    );
    expect(settingsBackupSubject(date, "Europe/Stockholm")).toBe(
      "Kurir settings backup - 17 Aug 2026",
    );
  });

  it("uses the previous calendar day when UTC has rolled over", () => {
    // 2026-08-17 01:00 UTC is still 16 Aug in America/Los_Angeles (UTC-7)
    const date = new Date("2026-08-17T01:00:00.000Z");
    expect(settingsBackupFilename(date, "America/Los_Angeles")).toBe(
      "kurir-settings-2026-08-16.json",
    );
  });
});
