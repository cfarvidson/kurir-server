import { describe, it, expect } from "vitest";
import {
  composeGroupsFromDraft,
  draftGroupNames,
  draftGroupsFromCompose,
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

  it("reopens a saved group in the same field with the same members unchecked, dropping a deleted group", () => {
    const restored = composeGroupsFromDraft(
      [
        { groupId: "gone", target: "TO", removedEmails: [] },
        { groupId: "g1", target: "BCC", removedEmails: ["bob@X.Y"] },
      ],
      [kultur, board],
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].group).toBe(kultur);
    expect(restored[0].target).toBe("bcc");
    expect([...restored[0].removedMemberIds]).toEqual(["m2"]);
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
