"use client";

import { useRef, useEffect, useCallback, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

const THRESHOLD = 64;
const MAX_PULL = 128;
const DIRECTION_LOCK_DISTANCE = 10;

/**
 * Native-feeling pull-to-refresh for iOS PWA standalone mode.
 *
 * All gesture animation is done via direct DOM manipulation (no React
 * state during touch) for 60fps. Only the refreshing/done states use
 * React state to trigger the RSC refresh via useTransition.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spinnerRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();

  // All mutable gesture state lives in a single ref object — no React re-renders.
  const state = useRef({
    startY: 0,
    startX: 0,
    pulling: false,
    refreshing: false,
    direction: null as "vertical" | "horizontal" | null,
    distance: 0,
  });

  const applyTransform = useCallback((distance: number, animate: boolean) => {
    const content = contentRef.current;
    const spinner = spinnerRef.current;
    if (!content || !spinner) return;

    const transition = animate
      ? "transform 0.3s cubic-bezier(0.2, 0, 0, 1)"
      : "none";
    content.style.transition = transition;
    content.style.transform = `translate3d(0, ${distance}px, 0)`;

    spinner.style.transition = transition;
    spinner.style.transform = `translate3d(0, ${distance - 40}px, 0)`;
    spinner.style.opacity = String(Math.min(distance / THRESHOLD, 1));

    // Move the mobile hamburger button with the content
    const hamburger = document.querySelector<HTMLElement>(
      "[data-mobile-hamburger]",
    );
    if (hamburger) {
      hamburger.style.transition = transition;
      hamburger.style.transform = `translate3d(0, ${distance}px, 0)`;
    }

    const svg = spinner.querySelector("svg");
    if (svg) {
      // Rotate proportionally during drag, spin continuously while refreshing
      if (!state.current.refreshing) {
        svg.style.transform = `rotate(${(distance / MAX_PULL) * 360}deg)`;
        svg.classList.remove("ptr-spinning");
      }
    }
  }, []);

  // The scroll container is <main>, the direct parent of our wrapper div
  const getScrollParent = useCallback(() => {
    return wrapperRef.current?.parentElement ?? null;
  }, []);

  // Start refreshing — called once on release past threshold
  const doRefresh = useCallback(() => {
    const s = state.current;
    s.refreshing = true;
    s.distance = THRESHOLD;
    applyTransform(THRESHOLD, true);

    const svg = spinnerRef.current?.querySelector("svg");
    if (svg) {
      svg.style.transform = "";
      svg.classList.add("ptr-spinning");
    }

    queryClient.invalidateQueries({ queryKey: ["messages"] });
    startTransition(() => {
      router.refresh();
    });
  }, [applyTransform, queryClient, router, startTransition]);

  // Reset to resting position
  const reset = useCallback(
    (animate: boolean) => {
      const s = state.current;
      s.distance = 0;
      s.pulling = false;
      s.direction = null;
      applyTransform(0, animate);

      if (animate) {
        // Clean up after animation
        setTimeout(() => {
          s.refreshing = false;
          const svg = spinnerRef.current?.querySelector("svg");
          if (svg) svg.classList.remove("ptr-spinning");
        }, 300);
      } else {
        s.refreshing = false;
      }
    },
    [applyTransform],
  );

  // Dismiss when RSC render settles
  useEffect(() => {
    if (state.current.refreshing && !isPending) {
      reset(true);
    }
  }, [isPending, reset]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    function onTouchStart(e: TouchEvent) {
      const s = state.current;
      if (s.refreshing) return;

      const scrollParent = getScrollParent();
      if (!scrollParent || scrollParent.scrollTop > 0) return;

      // Only activate when touching the header area (top 80px of scroll container)
      const rect = scrollParent.getBoundingClientRect();
      const touchY = e.touches[0].clientY;
      if (touchY - rect.top > 80) return;

      s.startY = touchY;
      s.startX = e.touches[0].clientX;
      s.pulling = true;
      s.direction = null;

      // Remove transition so drag follows finger immediately
      const content = contentRef.current;
      const spinner = spinnerRef.current;
      if (content) content.style.transition = "none";
      if (spinner) spinner.style.transition = "none";
    }

    function onTouchMove(e: TouchEvent) {
      const s = state.current;
      if (!s.pulling || s.refreshing) return;

      const dy = e.touches[0].clientY - s.startY;
      const dx = e.touches[0].clientX - s.startX;

      // Direction lock
      if (s.direction === null) {
        const total = Math.abs(dx) + Math.abs(dy);
        if (total > DIRECTION_LOCK_DISTANCE) {
          s.direction = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
        }
      }

      if (s.direction === "horizontal") {
        s.pulling = false;
        s.direction = null;
        applyTransform(0, false);
        return;
      }

      if (dy <= 0) {
        applyTransform(0, false);
        return;
      }

      // Re-check scroll position
      const scrollParent = getScrollParent();
      if (scrollParent && scrollParent.scrollTop > 0) {
        s.pulling = false;
        applyTransform(0, false);
        return;
      }

      // Exponential dampening — feels like rubber band
      const ratio = Math.min(dy / (MAX_PULL * 2.5), 1);
      const dampened = MAX_PULL * (1 - Math.pow(1 - ratio, 3));
      s.distance = dampened;
      applyTransform(dampened, false);

      if (dampened > 0) {
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      const s = state.current;
      if (!s.pulling) return;
      s.pulling = false;
      s.direction = null;

      if (s.distance >= THRESHOLD) {
        doRefresh();
      } else {
        reset(true);
      }
    }

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", onTouchMove, { passive: false });
    wrapper.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyTransform, doRefresh, getScrollParent, reset]);

  return (
    <div ref={wrapperRef} className="relative h-full">
      {/* Spinner — sits above content, translated into view */}
      <div
        ref={spinnerRef}
        className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-center"
        style={{ opacity: 0, transform: "translate3d(0, -40px, 0)" }}
      >
        <svg
          className="h-6 w-6 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        </svg>
      </div>

      {/* Content — translated down during pull, min-h-full so empty states can vertically center */}
      <div ref={contentRef} className="h-full">
        {children}
      </div>
    </div>
  );
}
