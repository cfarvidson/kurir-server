import { describe, it, expect } from "vitest";
import { ownSenderEmailWhere, visiblePendingSenderWhere } from "../pending-senders";
import type { OwnAddresses } from "../user-emails";

describe("ownSenderEmailWhere", () => {
  it("returns null when there are no own emails or domains", () => {
    const own: OwnAddresses = { emails: [], domains: [] };
    expect(ownSenderEmailWhere(own)).toBeNull();
  });

  it("builds an OR with an `in` clause when only emails are given", () => {
    const own: OwnAddresses = { emails: ["a@b.se", "c@d.se"], domains: [] };
    expect(ownSenderEmailWhere(own)).toEqual({
      OR: [{ email: { in: ["a@b.se", "c@d.se"] } }],
    });
  });

  it("builds an OR with one `endsWith` entry per domain when only domains are given", () => {
    const own: OwnAddresses = { emails: [], domains: ["x.se", "y.se"] };
    expect(ownSenderEmailWhere(own)).toEqual({
      OR: [
        { email: { endsWith: "@x.se" } },
        { email: { endsWith: "@y.se" } },
      ],
    });
  });

  it("puts the `in` entry first, followed by one `endsWith` per domain, when both are given", () => {
    const own: OwnAddresses = {
      emails: ["a@b.se"],
      domains: ["x.se", "y.se"],
    };
    expect(ownSenderEmailWhere(own)).toEqual({
      OR: [
        { email: { in: ["a@b.se"] } },
        { email: { endsWith: "@x.se" } },
        { email: { endsWith: "@y.se" } },
      ],
    });
  });
});

describe("visiblePendingSenderWhere", () => {
  it("has no NOT key when no own addresses are given", () => {
    const where = visiblePendingSenderWhere("user-1");
    expect(where).not.toHaveProperty("NOT");
    expect(where.userId).toBe("user-1");
    expect(where.status).toBe("PENDING");
  });

  it("includes a NOT clause covering both emails and domains, alongside the existing filters", () => {
    const own: OwnAddresses = { emails: ["a@b.se"], domains: ["c.se"] };
    const where = visiblePendingSenderWhere("user-1", own);
    expect(where).toMatchObject({
      userId: "user-1",
      status: "PENDING",
      NOT: {
        OR: [
          { email: { in: ["a@b.se"] } },
          { email: { endsWith: "@c.se" } },
        ],
      },
    });
    expect(
      (where as { messages: { some: { isArchived: boolean } } }).messages
        .some.isArchived,
    ).toBe(false);
  });
});
