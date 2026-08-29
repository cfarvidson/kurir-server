import { describe, it, expect } from "vitest";
import { personHistoryWhere } from "@/lib/mail/person-history";

describe("personHistoryWhere", () => {
  it("matches from or to across every list, including Archive", () => {
    expect(personHistoryWhere("user-1", ["ada@x.y", "ada@work.y"])).toEqual({
      userId: "user-1",
      OR: [
        { fromAddress: { equals: "ada@x.y", mode: "insensitive" } },
        { fromAddress: { equals: "ada@work.y", mode: "insensitive" } },
        { toAddresses: { hasSome: ["ada@x.y", "ada@work.y"] } },
      ],
    });
  });

  it("keeps mixed-case To addresses as well as lowercase", () => {
    const where = personHistoryWhere("user-1", ["Ada@X.Y"]);
    expect(where.OR).toEqual([
      { fromAddress: { equals: "Ada@X.Y", mode: "insensitive" } },
      { fromAddress: { equals: "ada@x.y", mode: "insensitive" } },
      { toAddresses: { hasSome: ["Ada@X.Y", "ada@x.y"] } },
    ]);
  });

  it("does not scope to Imbox or drop archived mail", () => {
    const where = personHistoryWhere("user-1", ["ada@x.y"]);
    expect(where).not.toHaveProperty("isArchived");
    expect(where).not.toHaveProperty("isInImbox");
    expect(where).not.toHaveProperty("isInFeed");
    expect(JSON.stringify(where)).not.toContain("isArchived");
  });
});
