import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for toast (pop-up notification) container styling.
 *
 * Both `<Toaster>` mounts (mail + admin layouts) and the custom undo toasts
 * read from here so every toast — success, error, or custom — shares one
 * consistent card chrome.
 */
export const TOAST_SHELL_CLASS =
  "border border-border bg-card text-card-foreground shadow-lg";

export const TOAST_SHELL_STYLE = {
  "--toast-bg": "hsl(var(--card))",
  "--toast-border": "hsl(var(--border))",
  "--toast-text": "hsl(var(--card-foreground))",
} as CSSProperties;

/**
 * Wrapper that gives `toast.custom(...)` content the same outer chrome that
 * sonner applies to standard toasts via `toastOptions.className`. Custom toasts
 * pass `unstyled: true` (so sonner adds no competing container), then render
 * their content inside this shell. Width and radius match a standard sonner
 * toast; padding lives on the inner content, so there is no double padding.
 */
export function ToastShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[356px] max-w-[calc(100vw-2rem)] rounded-lg",
        TOAST_SHELL_CLASS,
        className,
      )}
      style={TOAST_SHELL_STYLE}
    >
      {children}
    </div>
  );
}
