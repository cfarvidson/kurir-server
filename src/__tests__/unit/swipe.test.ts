import { describe, it, expect } from "vitest";
import { resolveSwipeAction } from "@/lib/mail/swipe";

// Row width 375 → distance threshold = 375 * 0.4 = 150px.
const WIDTH = 375;

describe("resolveSwipeAction", () => {
  it("triggers a right swipe when horizontal distance passes the threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: 200,
        offsetY: 10,
        velocityX: 0,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBe("right");
  });

  it("triggers a right swipe on a fast horizontal flick under the distance threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: 40,
        offsetY: 10,
        velocityX: 900,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBe("right");
  });

  it("triggers a left swipe when horizontal distance passes the threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: -200,
        offsetY: 10,
        velocityX: 0,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBe("left");
  });

  it("triggers a left swipe on a fast horizontal flick under the distance threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: -40,
        offsetY: 10,
        velocityX: -900,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBe("left");
  });

  // Regression: the bug this fix addresses — vertical scroll with incidental
  // horizontal drift past the threshold must NOT archive.
  it("does not swipe on a vertical scroll even when horizontal drift passes the threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: 200,
        offsetY: 400,
        velocityX: 0,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  // Regression: a fast vertical flick can carry horizontal velocity past the
  // threshold — still must not swipe.
  it("does not swipe on a vertical flick even when horizontal velocity passes the threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: 20,
        offsetY: -400,
        velocityX: 900,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  it("does not trigger a right swipe when right is disabled", () => {
    expect(
      resolveSwipeAction({
        offsetX: 200,
        offsetY: 10,
        velocityX: 900,
        width: WIDTH,
        canSwipeRight: false,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  it("does not trigger a left swipe when left is disabled", () => {
    expect(
      resolveSwipeAction({
        offsetX: -200,
        offsetY: 10,
        velocityX: -900,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: false,
      }),
    ).toBeNull();
  });

  it("does not swipe when below both distance and velocity thresholds", () => {
    expect(
      resolveSwipeAction({
        offsetX: 30,
        offsetY: 5,
        velocityX: 100,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  it("does not swipe at exactly the distance threshold (strictly-greater check)", () => {
    expect(
      resolveSwipeAction({
        offsetX: 150,
        offsetY: 10,
        velocityX: 0,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  it("does not swipe at exactly the velocity threshold (strictly-greater check)", () => {
    expect(
      resolveSwipeAction({
        offsetX: 40,
        offsetY: 5,
        velocityX: 500,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  it("does not swipe on an exactly-diagonal gesture (|offsetX| === |offsetY|)", () => {
    expect(
      resolveSwipeAction({
        offsetX: 200,
        offsetY: 200,
        velocityX: 0,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });

  // The axis guard short-circuits before velocity is evaluated, so a
  // vertical-dominant gesture is rejected even when horizontal velocity alone
  // would otherwise clear the velocity threshold.
  it("axis guard rejects a vertical-dominant gesture whose horizontal velocity exceeds the threshold", () => {
    expect(
      resolveSwipeAction({
        offsetX: 60,
        offsetY: 120,
        velocityX: 900,
        width: WIDTH,
        canSwipeRight: true,
        canSwipeLeft: true,
      }),
    ).toBeNull();
  });
});
