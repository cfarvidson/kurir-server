import { describe, it, expect } from "vitest";
import {
  personMatchesQuery,
  personHitFromContact,
  mergePersonHits,
  type PersonHitInput,
} from "@/lib/mail/search-contacts";

describe("personMatchesQuery", () => {
  const ada: PersonHitInput = {
    email: "ada@analytical.example",
    displayName: "Ada Lovelace",
    domain: "analytical.example",
  };

  it("matches display name", () => {
    expect(personMatchesQuery(ada, "love")).toBe(true);
  });

  it("matches email", () => {
    expect(personMatchesQuery(ada, "ada@")).toBe(true);
  });

  it("matches domain / company", () => {
    expect(personMatchesQuery(ada, "analytical")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(personMatchesQuery(ada, "LOVELACE")).toBe(true);
    expect(personMatchesQuery(ada, "Analytical.Example")).toBe(true);
  });

  it("rejects unrelated queries and whitespace", () => {
    expect(personMatchesQuery(ada, "babbage")).toBe(false);
    expect(personMatchesQuery(ada, "  ")).toBe(false);
  });
});

describe("mergePersonHits", () => {
  it("puts matching people in name then email order, capped at 5", () => {
    const senders: PersonHitInput[] = [
      {
        email: "ada@analytical.example",
        displayName: "Ada Lovelace",
        domain: "analytical.example",
      },
      {
        email: "charles@engine.example",
        displayName: "Charles Babbage",
        domain: "engine.example",
      },
    ];
    const contacts: PersonHitInput[] = [
      {
        email: "hello@engine.example",
        displayName: "Engine Co",
        domain: "engine.example",
      },
    ];
    const hits = mergePersonHits(senders, contacts, "engine");
    expect(hits.map((h) => h.email)).toEqual([
      "charles@engine.example",
      "hello@engine.example",
    ]);
  });

  it("dedupes a contact onto the sender and keeps the contact name", () => {
    const hits = mergePersonHits(
      [
        {
          email: "ada@x.y",
          displayName: "Ada From Header",
          domain: "x.y",
        },
      ],
      [
        {
          email: "ADA@x.y",
          displayName: "Ada Lovelace",
          domain: "x.y",
        },
      ],
      "ada",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.email).toBe("ada@x.y");
    expect(hits[0]?.displayName).toBe("Ada Lovelace");
  });

  it("uses the matching address when the primary does not match", () => {
    const hit = personHitFromContact(
      "c1",
      "Ada",
      ["ada@x.y", "ada@analytical.example"],
      "analytical",
    );
    expect(hit?.email).toBe("ada@analytical.example");
  });

  it("keeps the primary address when the name matches", () => {
    const hit = personHitFromContact(
      "c1",
      "Ada Lovelace",
      ["ada@x.y", "ada@work.y"],
      "lovelace",
    );
    expect(hit?.email).toBe("ada@x.y");
  });

  it("caps at five people", () => {
    const senders = Array.from({ length: 8 }, (_, i) => ({
      email: `p${i}@acme.example`,
      displayName: `Person ${i}`,
      domain: "acme.example",
    }));
    expect(mergePersonHits(senders, [], "acme")).toHaveLength(5);
  });
});
