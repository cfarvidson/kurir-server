"use client";

import { toast } from "sonner";
import { useCountdown } from "@/hooks/use-countdown";

interface UndoSendToastProps {
  sendId: string;
  recipientEmail: string;
  delayMs: number;
  onUndo: () => void;
  onComplete: () => void;
}

function UndoSendToastContent({
  recipientEmail,
  delayMs,
  onUndo,
  onComplete,
}: UndoSendToastProps) {
  const { remaining, progress } = useCountdown(delayMs, onComplete);
  const seconds = Math.ceil(remaining / 1000);
  const circumference = 2 * Math.PI * 14;

  return (
    <div className="flex w-full items-center gap-3">
      <div className="relative h-8 w-8 shrink-0">
        <svg className="-rotate-90 h-8 w-8" viewBox="0 0 32 32">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-muted-foreground/20"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * progress}
            strokeLinecap="round"
            className="text-primary transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
          {seconds}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Sending...</p>
        <p className="text-muted-foreground truncate text-xs">
          To {recipientEmail}
        </p>
      </div>

      <button
        onClick={onUndo}
        className="text-primary hover:bg-primary/20 bg-primary/10 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
      >
        Undo
      </button>
    </div>
  );
}

export function showUndoSendToast(
  sendId: string,
  recipientEmail: string,
  delayMs: number,
  onUndo: () => void,
  onComplete: () => void,
) {
  return toast.custom(
    (toastId) => (
      <UndoSendToastContent
        sendId={sendId}
        recipientEmail={recipientEmail}
        delayMs={delayMs}
        onUndo={() => {
          toast.dismiss(toastId);
          onUndo();
        }}
        onComplete={() => {
          toast.dismiss(toastId);
          onComplete();
        }}
      />
    ),
    {
      duration: delayMs + 1000,
      id: sendId,
    },
  );
}
