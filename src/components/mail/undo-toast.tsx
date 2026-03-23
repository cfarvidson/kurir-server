"use client";

import { toast } from "sonner";
import { useCountdown } from "@/hooks/use-countdown";

const UNDO_DELAY_MS = 5000;

function UndoToastContent({
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
  const seconds = Math.ceil(remaining / 1000);
  const circumference = 2 * Math.PI * 15;

  return (
    <div className="flex w-[360px] items-center gap-3 px-4 py-3">
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
  onUndo,
}: {
  id: string;
  label: string;
  description?: string;
  onUndo: () => void;
}) {
  toast.custom(
    (toastId) => (
      <UndoToastContent
        label={label}
        description={description}
        delayMs={UNDO_DELAY_MS}
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
      duration: UNDO_DELAY_MS + 1000,
      id,
      unstyled: true,
    },
  );

  return id;
}
