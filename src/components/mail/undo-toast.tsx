"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCountdown } from "@/hooks/use-countdown";
import {
  ToastShell,
  TOAST_UNSTYLED_RESET_CLASS,
} from "@/components/ui/toast-config";

const UNDO_DELAY_MS = 5000;

function UndoToastContent({
  label,
  description,
  delayMs,
  holdUntil,
  onUndo,
  onComplete,
}: {
  label: string;
  description?: string;
  delayMs: number;
  holdUntil?: Promise<unknown>;
  onUndo: () => void;
  onComplete: () => void;
}) {
  // When `holdUntil` is supplied, the countdown is paused (frozen at full) until
  // that promise settles — otherwise a slow archive round-trip could let the
  // toast expire while Undo is still the only recovery affordance.
  const [held, setHeld] = useState(Boolean(holdUntil));

  useEffect(() => {
    if (!holdUntil) return;
    let active = true;
    holdUntil.then(
      () => active && setHeld(false),
      () => active && setHeld(false),
    );
    return () => {
      active = false;
    };
  }, [holdUntil]);

  return held ? (
    <UndoToastRing
      label={label}
      description={description}
      progress={0}
      seconds={Math.ceil(delayMs / 1000)}
      onUndo={onUndo}
    />
  ) : (
    <UndoToastCountdown
      label={label}
      description={description}
      delayMs={delayMs}
      onUndo={onUndo}
      onComplete={onComplete}
    />
  );
}

function UndoToastCountdown({
  label,
  description,
  delayMs,
  onUndo,
  onComplete,
}: {
  label: string;
  description?: string;
  delayMs: number;
  onUndo: () => void;
  onComplete: () => void;
}) {
  const { remaining, progress } = useCountdown(delayMs, onComplete);
  return (
    <UndoToastRing
      label={label}
      description={description}
      progress={progress}
      seconds={Math.ceil(remaining / 1000)}
      onUndo={onUndo}
    />
  );
}

function UndoToastRing({
  label,
  description,
  progress,
  seconds,
  onUndo,
}: {
  label: string;
  description?: string;
  progress: number;
  seconds: number;
  onUndo: () => void;
}) {
  const circumference = 2 * Math.PI * 15;

  return (
    <ToastShell>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative h-9 w-9 shrink-0">
          <svg className="-rotate-90 h-9 w-9" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-muted-foreground/15"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * progress}
              strokeLinecap="round"
              className="text-primary transition-[stroke-dashoffset] duration-100"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
            {seconds}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {description && (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <button
          onClick={onUndo}
          className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Undo
        </button>
      </div>
    </ToastShell>
  );
}

/**
 * Show an undo toast with a countdown timer.
 * Returns the toast ID so it can be dismissed externally.
 */
export function showUndoToast({
  id,
  label,
  description,
  holdUntil,
  onUndo,
}: {
  id: string;
  label: string;
  description?: string;
  /** When provided, the countdown stays frozen at full until this settles,
   *  then runs normally. The toast manages its own dismissal in that case. */
  holdUntil?: Promise<unknown>;
  onUndo: () => void;
}) {
  toast.custom(
    (toastId) => (
      <UndoToastContent
        label={label}
        description={description}
        delayMs={UNDO_DELAY_MS}
        holdUntil={holdUntil}
        onUndo={() => {
          toast.dismiss(toastId);
          onUndo();
        }}
        onComplete={() => {
          toast.dismiss(toastId);
        }}
      />
    ),
    {
      // While held, let the component own dismissal (the sonner-level timer
      // must not expire the toast before the archive promise settles).
      duration: holdUntil ? Infinity : UNDO_DELAY_MS + 1000,
      id,
      unstyled: true,
      className: TOAST_UNSTYLED_RESET_CLASS,
    },
  );

  return id;
}
