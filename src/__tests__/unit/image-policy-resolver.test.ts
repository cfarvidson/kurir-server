import { describe, it, expect } from "vitest";
import {
  resolveImagePolicy,
  imagePolicyToFlags,
  imagePolicyToSanitizeFlags,
  type RemoteImagePolicy,
} from "@/lib/mail/image-policy";

describe("resolveImagePolicy", () => {
  it("maps blockRemoteImages=true to BLOCK_ALL regardless of blockTrackers", () => {
    expect(
      resolveImagePolicy({ blockRemoteImages: true, blockTrackers: true }),
    ).toBe("BLOCK_ALL");
    // Dead combination collapses to BLOCK_ALL.
    expect(
      resolveImagePolicy({ blockRemoteImages: true, blockTrackers: false }),
    ).toBe("BLOCK_ALL");
  });

  it("maps false/true to BLOCK_TRACKERS", () => {
    expect(
      resolveImagePolicy({ blockRemoteImages: false, blockTrackers: true }),
    ).toBe("BLOCK_TRACKERS");
  });

  it("maps false/false to ALLOW_ALL", () => {
    expect(
      resolveImagePolicy({ blockRemoteImages: false, blockTrackers: false }),
    ).toBe("ALLOW_ALL");
  });
});

describe("imagePolicyToFlags", () => {
  const cases: [RemoteImagePolicy, boolean, boolean][] = [
    ["BLOCK_ALL", true, true],
    ["BLOCK_TRACKERS", false, true],
    ["ALLOW_ALL", false, false],
  ];
  it.each(cases)(
    "%s -> blockRemoteImages=%s blockTrackers=%s",
    (policy, blockRemoteImages, blockTrackers) => {
      expect(imagePolicyToFlags(policy)).toEqual({
        blockRemoteImages,
        blockTrackers,
      });
    },
  );

  it("round-trips through resolveImagePolicy", () => {
    for (const policy of [
      "BLOCK_ALL",
      "BLOCK_TRACKERS",
      "ALLOW_ALL",
    ] as RemoteImagePolicy[]) {
      expect(resolveImagePolicy(imagePolicyToFlags(policy))).toBe(policy);
    }
  });
});

describe("imagePolicyToSanitizeFlags", () => {
  it("BLOCK_ALL strips everything", () => {
    expect(imagePolicyToSanitizeFlags("BLOCK_ALL")).toEqual({
      blockRemoteImages: true,
      blockTrackers: false,
    });
  });

  it("BLOCK_TRACKERS loads images but filters trackers", () => {
    expect(imagePolicyToSanitizeFlags("BLOCK_TRACKERS")).toEqual({
      blockRemoteImages: false,
      blockTrackers: true,
    });
  });

  it("ALLOW_ALL loads everything", () => {
    expect(imagePolicyToSanitizeFlags("ALLOW_ALL")).toEqual({
      blockRemoteImages: false,
      blockTrackers: false,
    });
  });
});
