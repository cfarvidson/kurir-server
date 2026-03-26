import { describe, it, expect, beforeEach } from "vitest";
import { keyboardState } from "@/lib/keyboard-state";

describe("keyboard-state", () => {
  beforeEach(() => {
    keyboardState.gSequenceActive = false;
  });

  it("starts with gSequenceActive false", () => {
    expect(keyboardState.gSequenceActive).toBe(false);
  });

  it("can be set to true", () => {
    keyboardState.gSequenceActive = true;
    expect(keyboardState.gSequenceActive).toBe(true);
  });

  it("is shared across imports (same reference)", async () => {
    keyboardState.gSequenceActive = true;
    // Re-importing should give the same object
    const { keyboardState: reimported } = await import("@/lib/keyboard-state");
    expect(reimported.gSequenceActive).toBe(true);
  });
});
