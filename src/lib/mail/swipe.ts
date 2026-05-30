/**
 * Pure decision logic for the swipeable mail row.
 *
 * Extracted so the threshold/velocity/axis rules are unit-testable without
 * driving `motion`/DOM. Consumed by `src/components/mail/swipeable-row.tsx`.
 */

export interface SwipeDecisionInput {
  /** Horizontal offset from drag start (px). Positive = rightward. */
  offsetX: number;
  /** Vertical offset from drag start (px). */
  offsetY: number;
  /** Horizontal velocity at release (px/s). */
  velocityX: number;
  /** Width of the row, used to derive the distance threshold. */
  width: number;
  /** Whether a right-swipe action is wired up. */
  canSwipeRight: boolean;
  /** Whether a left-swipe action is wired up. */
  canSwipeLeft: boolean;
}

export type SwipeAction = "right" | "left" | null;

const DISTANCE_RATIO = 0.4;
const VELOCITY_THRESHOLD = 500;

/**
 * Decide whether a completed drag should trigger a swipe action.
 *
 * A swipe only fires when the gesture is *predominantly horizontal*
 * (`|offsetX| > |offsetY|`). This is what prevents a vertical scroll — which
 * can accumulate incidental horizontal drift or velocity — from being misread
 * as a deliberate swipe. The same direction-lock principle is used in
 * `src/components/mail/pull-to-refresh.tsx`.
 */
export function resolveSwipeAction({
  offsetX,
  offsetY,
  velocityX,
  width,
  canSwipeRight,
  canSwipeLeft,
}: SwipeDecisionInput): SwipeAction {
  const threshold = width * DISTANCE_RATIO;
  const isHorizontal = Math.abs(offsetX) > Math.abs(offsetY);

  if (!isHorizontal) return null;

  if (
    canSwipeRight &&
    offsetX > 0 &&
    (offsetX > threshold || velocityX > VELOCITY_THRESHOLD)
  ) {
    return "right";
  }

  if (
    canSwipeLeft &&
    offsetX < 0 &&
    (offsetX < -threshold || velocityX < -VELOCITY_THRESHOLD)
  ) {
    return "left";
  }

  return null;
}
