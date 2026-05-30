import { describe, it, expect } from "vitest";
import { computeRenderScale } from "@/components/mail/pdf-canvas";

describe("computeRenderScale", () => {
  it("fits a page narrower than the container by enlarging it to the full width", () => {
    // 400pt page in an 800px container, dpr 1 -> 2x to fill width.
    expect(computeRenderScale(800, 400, 1)).toBe(2);
  });

  it("fits a page wider than the container by shrinking it to the full width", () => {
    // 1000pt page in a 500px container, dpr 1 -> 0.5x to fit.
    expect(computeRenderScale(500, 1000, 1)).toBe(0.5);
  });

  it("multiplies the backing-store scale by the device pixel ratio", () => {
    // Same fit (1x), but dpr 2 doubles the backing-store resolution.
    expect(computeRenderScale(600, 600, 2)).toBe(2);
    expect(computeRenderScale(800, 400, 2)).toBe(4);
  });

  it("falls back to the device pixel ratio when the container has no width yet", () => {
    expect(computeRenderScale(0, 400, 1)).toBe(1);
    expect(computeRenderScale(0, 400, 2)).toBe(2);
  });

  it("falls back when the page width is unknown", () => {
    expect(computeRenderScale(800, 0, 2)).toBe(2);
  });

  it("treats a non-positive dpr as 1x", () => {
    expect(computeRenderScale(800, 400, 0)).toBe(2);
  });
});
