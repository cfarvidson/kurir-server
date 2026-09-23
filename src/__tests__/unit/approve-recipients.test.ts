import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sender: { upsert: vi.fn(), update: vi.fn() },
    message: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { approveRecipients } from "@/lib/mail/approve-recipients";

const own = { emails: ["me@mine.example"], domains: [] };

describe("approveRecipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new recipient as an approved Imbox sender and skips own addresses", async () => {
    vi.mocked(db.sender.upsert).mockResolvedValue({
      id: "s1",
      status: "APPROVED",
    } as any);

    await approveRecipients(
      "u1",
      "c1",
      [" Konsument@it-auktion.se ", "me@mine.example", "not-an-address"],
      own,
    );

    expect(db.sender.upsert).toHaveBeenCalledTimes(1);
    expect(db.sender.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailConnectionId_email: {
            emailConnectionId: "c1",
            email: "konsument@it-auktion.se",
          },
        },
        create: expect.objectContaining({
          status: "APPROVED",
          category: "IMBOX",
          domain: "it-auktion.se",
          decidedAt: expect.any(Date),
        }),
        update: {},
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("flips a pending sender to the Imbox and moves their screener mail, but leaves rejected ones", async () => {
    vi.mocked(db.sender.upsert)
      .mockResolvedValueOnce({ id: "pending", status: "PENDING" } as any)
      .mockResolvedValueOnce({ id: "rejected", status: "REJECTED" } as any);

    await approveRecipients("u1", "c1", ["a@x.example", "b@x.example"]);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.sender.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pending" },
        data: expect.objectContaining({ status: "APPROVED", category: "IMBOX" }),
      }),
    );
    expect(db.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { senderId: "pending", isArchived: false, subjectRuleId: null },
        data: expect.objectContaining({ isInScreener: false, isInImbox: true }),
      }),
    );
  });
});
