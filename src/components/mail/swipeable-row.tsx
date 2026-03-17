"use client";

import { useRef, useMemo } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Archive, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwipeableRowProps {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  swipeRightIcon?: React.ReactNode;
  swipeRightColor?: string;
  swipeLeftIcon?: React.ReactNode;
  swipeLeftColor?: string;
  disabled?: boolean;
}

export function SwipeableRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  swipeRightIcon,
  swipeRightColor = "bg-green-600",
  swipeLeftIcon,
  swipeLeftColor = "bg-amber-500",
  disabled,
}: SwipeableRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  const rightIconOpacity = useTransform(x, [0, 60, 120], [0, 0.5, 1]);
  const rightIconScale = useTransform(x, [0, 60, 120], [0.5, 0.8, 1]);
  const leftIconOpacity = useTransform(x, [-120, -60, 0], [1, 0.5, 0]);
  const leftIconScale = useTransform(x, [-120, -60, 0], [1, 0.8, 0.5]);

  const dragConstraints = useMemo(
    () => ({
      left: onSwipeLeft ? -150 : 0,
      right: onSwipeRight ? 150 : 0,
    }),
    [onSwipeLeft, onSwipeRight],
  );

  if (disabled || (!onSwipeRight && !onSwipeLeft)) {
    return <>{children}</>;
  }

  function handleDragEnd(
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    const width = rowRef.current?.offsetWidth ?? 375;
    const threshold = width * 0.4;
    const velocityThreshold = 500;

    if (
      onSwipeRight &&
      (info.offset.x > threshold || info.velocity.x > velocityThreshold)
    ) {
      onSwipeRight();
    } else if (
      onSwipeLeft &&
      (info.offset.x < -threshold || info.velocity.x < -velocityThreshold)
    ) {
      onSwipeLeft();
    }
  }

  return (
    <div ref={rowRef} className="relative overflow-hidden">
      {onSwipeRight && (
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 flex items-center pl-6 text-white",
            swipeRightColor,
          )}
          style={{ opacity: rightIconOpacity, width: "100%" }}
        >
          <motion.div style={{ scale: rightIconScale }}>
            {swipeRightIcon || <Archive className="h-5 w-5" />}
          </motion.div>
        </motion.div>
      )}

      {onSwipeLeft && (
        <motion.div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end pr-6 text-white",
            swipeLeftColor,
          )}
          style={{ opacity: leftIconOpacity, width: "100%" }}
        >
          <motion.div style={{ scale: leftIconScale }}>
            {swipeLeftIcon || <Clock className="h-5 w-5" />}
          </motion.div>
        </motion.div>
      )}

      <motion.div
        style={{ x, touchAction: "pan-y" }}
        drag="x"
        dragDirectionLock
        dragConstraints={dragConstraints}
        dragElastic={0.15}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        className="relative z-10 bg-background"
      >
        {children}
      </motion.div>
    </div>
  );
}
