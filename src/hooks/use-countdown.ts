"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function useCountdown(durationMs: number, onComplete: () => void) {
  const [remaining, setRemaining] = useState(durationMs);
  const startRef = useRef(Date.now());
  const completedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const left = Math.max(0, durationMs - elapsed);
    setRemaining(left);

    if (left <= 0 && !completedRef.current) {
      completedRef.current = true;
      onCompleteRef.current();
    } else if (left > 0) {
      timerRef.current = setTimeout(tick, 66); // ~15fps for smooth progress
    }
  }, [durationMs]);

  useEffect(() => {
    startRef.current = Date.now();
    completedRef.current = false;
    tick();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tick]);

  const progress = 1 - remaining / durationMs; // 0 → 1

  return { remaining, progress };
}
