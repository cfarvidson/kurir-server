import { describe, it, expect } from "vitest";
import {
  expandGroups,
  liveMemberCount,
  type AddedGroup,
} from "@/lib/mail/group-expansion";

const member = (memberId: string, email: string) => ({ memberId, email });

describe("expandGroups", () => {
  it("expands a TO group to its member addresses", () => {
    const groups: AddedGroup[] = [
      {
        groupId: "g1",
        target: "to",
        members: [
          member("m1", "a@x.com"),
          member("m2", "b@x.com"),
          member("m3", "c@x.com"),
        ],
      },
    ];
    expect(expandGroups(groups)).toEqual({
      to: ["a@x.com", "b@x.com", "c@x.com"],
      cc: [],
      bcc: [],
    });
  });

  it("excludes members removed for this send (AE2)", () => {
    const groups: AddedGroup[] = [
      {
        groupId: "g1",
        target: "to",
        members: [
          member("m1", "a@x.com"),
          member("m2", "b@x.com"),
          member("m3", "c@x.com"),
        ],
        removedMemberIds: ["m3"],
      },
    ];
    expect(expandGroups(groups).to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("does not include members absent from the live list (deleted contact, R14/AE6)", () => {
    // c@x.com's contact was deleted, so it is simply not in members[].
    const groups: AddedGroup[] = [
      {
        groupId: "g1",
        target: "to",
        members: [member("m1", "a@x.com"), member("m2", "b@x.com")],
      },
    ];
    expect(expandGroups(groups).to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("dedupes case-insensitively across groups, first form kept", () => {
    const groups: AddedGroup[] = [
      { groupId: "g1", target: "to", members: [member("m1", "Alice@X.com")] },
      { groupId: "g2", target: "to", members: [member("m2", "alice@x.com")] },
    ];
    expect(expandGroups(groups).to).toEqual(["Alice@X.com"]);
  });

  it("routes Bcc/Cc groups to the correct bucket regardless of order", () => {
    const groups: AddedGroup[] = [
      { groupId: "g1", target: "bcc", members: [member("m1", "a@x.com")] },
      { groupId: "g2", target: "cc", members: [member("m2", "b@x.com")] },
    ];
    expect(expandGroups(groups)).toEqual({
      to: [],
      cc: ["b@x.com"],
      bcc: ["a@x.com"],
    });
  });

  it("a member in two groups targeting different buckets lands once, first bucket wins", () => {
    const groups: AddedGroup[] = [
      { groupId: "g1", target: "to", members: [member("m1", "a@x.com")] },
      { groupId: "g2", target: "bcc", members: [member("m2", "a@x.com")] },
    ];
    const out = expandGroups(groups);
    expect(out.to).toEqual(["a@x.com"]);
    expect(out.bcc).toEqual([]);
  });

  it("returns empty buckets for an empty group or all-removed group (no throw)", () => {
    expect(expandGroups([])).toEqual({ to: [], cc: [], bcc: [] });
    const groups: AddedGroup[] = [
      {
        groupId: "g1",
        target: "to",
        members: [member("m1", "a@x.com")],
        removedMemberIds: ["m1"],
      },
    ];
    expect(expandGroups(groups)).toEqual({ to: [], cc: [], bcc: [] });
  });

  it("skips blank addresses", () => {
    const groups: AddedGroup[] = [
      { groupId: "g1", target: "to", members: [member("m1", "  ")] },
    ];
    expect(expandGroups(groups).to).toEqual([]);
  });
});

describe("liveMemberCount", () => {
  it("counts members minus per-send removals", () => {
    const group: AddedGroup = {
      groupId: "g1",
      target: "to",
      members: [member("m1", "a@x.com"), member("m2", "b@x.com")],
      removedMemberIds: ["m2"],
    };
    expect(liveMemberCount(group)).toBe(1);
  });

  it("is zero when all members removed", () => {
    const group: AddedGroup = {
      groupId: "g1",
      target: "to",
      members: [member("m1", "a@x.com")],
      removedMemberIds: ["m1"],
    };
    expect(liveMemberCount(group)).toBe(0);
  });
});
