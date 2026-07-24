import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getConnectionCredentialsInternal: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("imapflow", () => ({ ImapFlow: vi.fn() }));
vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));
vi.mock("@/lib/mail/flag-push", () => ({ suppressEcho: vi.fn() }));
vi.mock("@/lib/mail/imap-client", () => ({ findArchiveMailbox: vi.fn() }));
vi.mock("@/lib/mail/auth-helpers", () => ({ buildImapAuth: vi.fn() }));
vi.mock("@/lib/mail/tombstones", () => ({
  deleteMessagesWithTombstones: vi.fn(),
}));

import { selectSyncCandidates, advanceWatermark } from "@/lib/mail/sync-service";

describe("selectSyncCandidates", () => {
  it("excludes uids at or below the watermark", () => {
    expect(selectSyncCandidates([1, 2, 3, 4], new Set(), 2)).toEqual([3, 4]);
  });

  it("excludes uids already cached for the folder", () => {
    expect(selectSyncCandidates([3, 4, 5], new Set([4]), 0)).toEqual([3, 5]);
  });

  it("returns everything new with a zero watermark and empty cache", () => {
    expect(selectSyncCandidates([7, 9], new Set(), 0)).toEqual([7, 9]);
  });

  it("returns nothing when all uids are below the watermark", () => {
    // The dedup-skipped Archive scenario: previously examined uids must
    // not be treated as new on every sync cycle.
    expect(selectSyncCandidates([10, 20, 30], new Set(), 30)).toEqual([]);
  });
});

describe("advanceWatermark", () => {
  it("advances to the highest uid after a clean complete pass", () => {
    expect(
      advanceWatermark({
        current: 5,
        allUids: [1, 9, 7],
        remaining: 0,
        errorCount: 0,
      }),
    ).toBe(9);
  });

  it("does not advance while a backfill has remaining messages", () => {
    expect(
      advanceWatermark({
        current: 5,
        allUids: [1, 9, 7],
        remaining: 3,
        errorCount: 0,
      }),
    ).toBe(5);
  });

  it("does not advance when the pass had errors", () => {
    expect(
      advanceWatermark({
        current: 5,
        allUids: [9],
        remaining: 0,
        errorCount: 1,
      }),
    ).toBe(5);
  });

  it("never moves backwards", () => {
    expect(
      advanceWatermark({
        current: 50,
        allUids: [9],
        remaining: 0,
        errorCount: 0,
      }),
    ).toBe(50);
  });

  it("keeps the watermark for an empty folder", () => {
    expect(
      advanceWatermark({ current: 5, allUids: [], remaining: 0, errorCount: 0 }),
    ).toBe(5);
  });
});
