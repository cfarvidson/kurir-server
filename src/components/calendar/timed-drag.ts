export const TIMED_DRAG_THRESHOLD_PX = 6;

export function pointerPastThreshold(
  originX: number,
  originY: number,
  x: number,
  y: number,
  thresholdPx = TIMED_DRAG_THRESHOLD_PX,
): boolean {
  const dx = x - originX;
  const dy = y - originY;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}

export function timedPlacementChanged(args: {
  originalDay: string;
  currentDay: string;
  originalStart: number;
  originalEnd: number;
  startMin: number;
  endMin: number;
}): boolean {
  return (
    args.originalDay !== args.currentDay ||
    args.originalStart !== args.startMin ||
    args.originalEnd !== args.endMin
  );
}
