import { describe, it, expect } from "vitest";

/**
 * Tests for keyboard shortcut configuration and mappings.
 * These test the pure data/logic, not the React components.
 */

const GOTO_MAP: Record<string, string> = {
  i: "/imbox",
  f: "/feed",
  p: "/paper-trail",
  s: "/sent",
  a: "/archive",
  n: "/screener",
};

const LISTING_PATHS = new Set([
  "/imbox",
  "/feed",
  "/paper-trail",
  "/screener",
  "/archive",
  "/sent",
  "/snoozed",
  "/follow-up",
]);

describe("keyboard shortcut mappings", () => {
  describe("GOTO_MAP", () => {
    it("maps g+i to /imbox", () => {
      expect(GOTO_MAP["i"]).toBe("/imbox");
    });

    it("maps g+f to /feed", () => {
      expect(GOTO_MAP["f"]).toBe("/feed");
    });

    it("maps g+p to /paper-trail", () => {
      expect(GOTO_MAP["p"]).toBe("/paper-trail");
    });

    it("maps g+s to /sent", () => {
      expect(GOTO_MAP["s"]).toBe("/sent");
    });

    it("maps g+a to /archive", () => {
      expect(GOTO_MAP["a"]).toBe("/archive");
    });

    it("maps g+n to /screener", () => {
      expect(GOTO_MAP["n"]).toBe("/screener");
    });

    it("returns undefined for unmapped keys", () => {
      expect(GOTO_MAP["z"]).toBeUndefined();
      expect(GOTO_MAP["x"]).toBeUndefined();
    });

    it("all go-to targets are valid listing paths", () => {
      for (const [key, path] of Object.entries(GOTO_MAP)) {
        expect(LISTING_PATHS.has(path)).toBe(true);
      }
    });
  });

  describe("LISTING_PATHS", () => {
    it("includes all expected mail list routes", () => {
      const expected = [
        "/imbox",
        "/feed",
        "/paper-trail",
        "/screener",
        "/archive",
        "/sent",
        "/snoozed",
        "/follow-up",
      ];
      for (const path of expected) {
        expect(LISTING_PATHS.has(path)).toBe(true);
      }
    });

    it("does not include non-list routes", () => {
      expect(LISTING_PATHS.has("/compose")).toBe(false);
      expect(LISTING_PATHS.has("/contacts")).toBe(false);
      expect(LISTING_PATHS.has("/settings")).toBe(false);
      expect(LISTING_PATHS.has("/login")).toBe(false);
      expect(LISTING_PATHS.has("/imbox/some-id")).toBe(false);
    });
  });
});

describe("isInputFocused logic", () => {
  // Mirrors the isInputFocused function used across handlers
  function isInputFocused(tagName: string, isContentEditable: boolean) {
    return (
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      isContentEditable
    );
  }

  it("returns true for INPUT", () => {
    expect(isInputFocused("INPUT", false)).toBe(true);
  });

  it("returns true for TEXTAREA", () => {
    expect(isInputFocused("TEXTAREA", false)).toBe(true);
  });

  it("returns true for SELECT", () => {
    expect(isInputFocused("SELECT", false)).toBe(true);
  });

  it("returns true for contentEditable", () => {
    expect(isInputFocused("DIV", true)).toBe(true);
  });

  it("returns false for normal elements", () => {
    expect(isInputFocused("DIV", false)).toBe(false);
    expect(isInputFocused("BUTTON", false)).toBe(false);
    expect(isInputFocused("A", false)).toBe(false);
    expect(isInputFocused("SPAN", false)).toBe(false);
  });
});

describe("shortcut definitions completeness", () => {
  // Ensure all keyboard shortcuts are documented and non-overlapping within context

  const listKeys = ["j", "k", "Enter", "e", "s", "x", "Shift+U", "/", "c"];
  const threadKeys = ["r", "j", "k", "Esc"];
  const threadSharedKeys = ["e", "s", "Shift+U"];
  const composeKeys = ["Cmd+Enter", "Cmd+Shift+Enter", "Esc"];
  const goToKeys = ["g+i", "g+f", "g+p", "g+s", "g+a", "g+n"];

  it("list view has no duplicate single-key shortcuts", () => {
    const singles = listKeys.filter((k) => !k.includes("+"));
    const unique = new Set(singles);
    expect(unique.size).toBe(singles.length);
  });

  it("thread view has no duplicate single-key shortcuts", () => {
    const allThread = [...threadKeys, ...threadSharedKeys];
    const singles = allThread.filter((k) => !k.includes("+"));
    const unique = new Set(singles);
    expect(unique.size).toBe(singles.length);
  });

  it("go-to keys all have unique second key", () => {
    const secondKeys = goToKeys.map((k) => k.split("+")[1]);
    const unique = new Set(secondKeys);
    expect(unique.size).toBe(secondKeys.length);
  });

  it("list single keys don't conflict with go-to sequence starter", () => {
    // "g" should not be a list shortcut since it starts go-to
    const singles = listKeys.filter((k) => !k.includes("+"));
    expect(singles).not.toContain("g");
  });
});
