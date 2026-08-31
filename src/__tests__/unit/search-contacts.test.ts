import { describe, it, expect, vi, beforeEach } from "vitest";

const findPeople = vi.fn();
vi.mock("@/lib/mail/people-search", () => ({
  findPeople: (...args: unknown[]) => findPeople(...args),
}));

import { searchContacts, SEARCH_PEOPLE_LIMIT } from "@/lib/mail/search-contacts";

describe("searchContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findPeople.mockResolvedValue([
      {
        email: "anna@acme.se",
        displayName: "Anna",
        domain: "acme.se",
        score: 10,
        matchedBy: "name",
        domainHint: null,
        contactId: "c1",
        emails: ["anna@acme.se"],
        category: null,
      },
      {
        email: "cc-only@acme.se",
        displayName: null,
        domain: "acme.se",
        score: 1,
        matchedBy: "domain",
        domainHint: "acme.se",
        contactId: null,
        emails: ["cc-only@acme.se"],
        category: "FEED",
      },
    ]);
  });

  it("answers from the first character with the People group cap", async () => {
    const hits = await searchContacts("u1", "a");
    expect(findPeople).toHaveBeenCalledWith("u1", "a", SEARCH_PEOPLE_LIMIT);
    expect(hits).toEqual([
      {
        id: "c1",
        email: "anna@acme.se",
        displayName: "Anna",
        category: "IMBOX",
        domain: "acme.se",
        contactId: "c1",
      },
      {
        id: "cc-only@acme.se",
        email: "cc-only@acme.se",
        displayName: null,
        category: "FEED",
        domain: "acme.se",
        contactId: null,
      },
    ]);
  });

  it("does nothing for a blank query", async () => {
    expect(await searchContacts("u1", "  ")).toEqual([]);
    expect(findPeople).not.toHaveBeenCalled();
  });
});
