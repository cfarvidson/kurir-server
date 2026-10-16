import { describe, it, expect } from "vitest";
import {
  composeGroupsFromDraft,
  draftGroupNames,
  draftGroupsFromCompose,
  draftGroupsSchema,
  parseDraftGroups,
  resolveGroupRefs,
  sameDraftGroups,
} from "@/lib/mail/draft-groups";
import type { ComposeGroup } from "@/components/mail/recipient-group-chip";

const kultur: ComposeGroup = {
  id: "g1",
  name: "Kultur föreningen",
  defaultTarget: "TO",
  members: [
    { memberId: "m1", contactEmailId: "e1", email: "ada@x.y", name: "Ada" },
    { memberId: "m2", contactEmailId: "e2", email: "Bob@x.y", name: "Bob" },
  ],
};
const board: ComposeGroup = {
  id: "g2",
  name: "Board",
  defaultTarget: "BCC",
  members: [],
};

describe("draft groups", () => {
  it("saves a compose chip as its target and unchecked members' emails", () => {
    expect(
      draftGroupsFromCompose([
        { group: kultur, target: "cc", removedMemberIds: new Set(["m2"]) },
      ]),
    ).toEqual([{ groupId: "g1", target: "CC", removedEmails: ["Bob@x.y"] }]);
  });

  it("reopens a saved group in the same field with the same members unchecked, keeping a missing group apart", () => {
    const missing = { groupId: "gone", target: "BCC" as const, removedEmails: ["a@x.y"] };
    const { chips, unavailable } = composeGroupsFromDraft(
      [missing, { groupId: "g1", target: "BCC", removedEmails: ["bob@X.Y"] }],
      [kultur, board],
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].group).toBe(kultur);
    expect(chips[0].target).toBe("bcc");
    expect([...chips[0].removedMemberIds]).toEqual(["m2"]);
    expect(unavailable).toEqual([missing]);
  });

  it("saves a missing group back as it was, next to the chips", () => {
    const missing = { groupId: "gone", target: "TO" as const, removedEmails: [] };
    expect(
      draftGroupsFromCompose(
        [{ group: board, target: "bcc", removedMemberIds: new Set<string>() }],
        [missing],
      ),
    ).toEqual([
      { groupId: "g2", target: "BCC", removedEmails: [] },
      missing,
    ]);
  });

  it("compares groups by value, so key order from the database is not an edit", () => {
    const stored = parseDraftGroups([
      { target: "TO", groupId: "g1", removedEmails: [] },
    ]);
    expect(
      sameDraftGroups(stored, [
        { groupId: "g1", target: "TO", removedEmails: [] },
      ]),
    ).toBe(true);
    expect(
      sameDraftGroups(stored, [
        { groupId: "g1", target: "TO", removedEmails: ["ada@x.y"] },
      ]),
    ).toBe(false);
    expect(parseDraftGroups(undefined)).toEqual([]);
  });

  it("caps a draft at 50 groups of at most 500 unchecked members each", () => {
    const group = (removed: number) => ({
      groupId: "g1",
      target: "TO",
      removedEmails: Array.from({ length: removed }, (_, i) => `m${i}@x.y`),
    });
    expect(draftGroupsSchema.safeParse(Array(50).fill(group(500))).success).toBe(
      true,
    );
    expect(draftGroupsSchema.safeParse(Array(51).fill(group(0))).success).toBe(
      false,
    );
    expect(draftGroupsSchema.safeParse([group(501)]).success).toBe(false);
  });

  it("resolves a group by id first, then by trimmed case-insensitive name", () => {
    expect(resolveGroupRefs([kultur, board], ["g2", " kultur FÖRENINGEN "]))
      .toEqual({ ok: true, groups: [board, kultur] });
  });

  it("asks for the id when several groups share the name, and names an unknown group", () => {
    const twin = { ...board, id: "g3" };
    expect(resolveGroupRefs([board, twin], ["board"])).toEqual({
      ok: false,
      message: expect.stringMatching(/several.*"board".*id/i),
    });
    expect(resolveGroupRefs([board], ["Family"])).toEqual({
      ok: false,
      message: expect.stringMatching(/"Family"/),
    });
  });

  it("names a draft's groups that still exist", () => {
    expect(
      draftGroupNames(
        [
          { groupId: "g1", target: "TO", removedEmails: [] },
          { groupId: "gone", target: "BCC", removedEmails: [] },
        ],
        [kultur, board],
      ),
    ).toEqual(["Kultur föreningen"]);
  });
});
