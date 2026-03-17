"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 60;
const MAX_PULL = 120;
const DIRECTION_LOCK_DISTANCE = 10;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Refs for touch tracking (avoid re-renders during gesture)
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const isPulling = useRef(false);
  const directionLocked = useRef<"vertical" | "horizontal" | null>(null);
  const pullDistanceRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  // Dismiss spinner when RSC render settles
  useEffect(() => {
    if (isRefreshing && !isPending) {
      setIsTransitioning(true);
      pullDistanceRef.current = 0;
      setPullDistance(0);
      const id = setTimeout(() => {
        setIsRefreshing(false);
        setIsTransitioning(false);
      }, 300);
      timersRef.current.push(id);
    }
  }, [isRefreshing, isPending]);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (isRefreshing) return;
      // The scroll container is the <main> parent
      const scrollParent = containerRef.current?.parentElement;
      if (!scrollParent || scrollParent.scrollTop > 0) return;

      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
      isPulling.current = true;
      directionLocked.current = null;
      setIsTransitioning(false);
    },
    [isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;

      const deltaY = e.touches[0].clientY - touchStartY.current;
      const deltaX = e.touches[0].clientX - touchStartX.current;

      // Direction lock: decide once whether this is vertical or horizontal
      if (directionLocked.current === null) {
        const totalMovement = Math.abs(deltaX) + Math.abs(deltaY);
        if (totalMovement > DIRECTION_LOCK_DISTANCE) {
          directionLocked.current =
            Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
        }
      }

      // If locked horizontal, abort — let SwipeableRow handle it
      if (directionLocked.current === "horizontal") {
        isPulling.current = false;
        directionLocked.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Only pull down, not up
      if (deltaY <= 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Check scroll position again (user might have scrolled during touch)
      const scrollParent = containerRef.current?.parentElement;
      if (scrollParent && scrollParent.scrollTop > 0) {
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Dampen the pull with diminishing returns
      const dampened = Math.min(deltaY * 0.5, MAX_PULL);
      pullDistanceRef.current = dampened;
      setPullDistance(dampened);

      // Prevent native scroll while pulling
      if (dampened > 0) {
        e.preventDefault();
      }
    },
    [isRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current) return;
    isPulling.current = false;
    directionLocked.current = null;

    const distance = pullDistanceRef.current;

    if (distance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setIsTransitioning(true);
      pullDistanceRef.current = THRESHOLD;
      setPullDistance(THRESHOLD);

      // Trigger refresh inside a transition so isPending tracks completion
      startTransition(() => {
        router.refresh();
      });
    } else {
      setIsTransitioning(true);
      pullDistanceRef.current = 0;
      setPullDistance(0);
      const id = setTimeout(() => setIsTransitioning(false), 300);
      timersRef.current.push(id);
    }
  }, [isRefreshing, router, startTransition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use { passive: false } on touchmove so we can preventDefault
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const isPastThreshold = pullDistance >= THRESHOLD;
  const spinnerOpacity = Math.min(pullDistance / THRESHOLD, 1);
  const spinnerScale = 0.5 + Math.min(pullDistance / THRESHOLD, 1) * 0.5;

  return (
    <div ref={containerRef} className="relative">
      {/* Pull indicator */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-center overflow-hidden"
        style={{
          height: `${pullDistance}px`,
          transition: isTransitioning ? "height 0.3s ease-out" : "none",
        }}
      >
        <div
          style={{
            opacity: spinnerOpacity,
            transform: `scale(${spinnerScale})`,
            transition: isTransitioning
              ? "opacity 0.3s ease-out, transform 0.3s ease-out"
              : "none",
          }}
        >
          <RefreshCw
            className={`h-6 w-6 text-muted-foreground ${
              isRefreshing || isPastThreshold ? "animate-spin" : ""
            }`}
            style={{
              transform: isRefreshing
                ? undefined
                : `rotate(${(pullDistance / MAX_PULL) * 360}deg)`,
            }}
          />
        </div>
      </div>

      {/* Content pushed down by pull distance */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isTransitioning ? "transform 0.3s ease-out" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
