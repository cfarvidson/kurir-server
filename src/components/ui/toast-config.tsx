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
  "border border-border bg-card text-card-foreground shadow-overlay";

export const TOAST_SHELL_STYLE = {
  "--toast-bg": "hsl(var(--card))",
  "--toast-border": "hsl(var(--border))",
  "--toast-text": "hsl(var(--card-foreground))",
} as CSSProperties;

/**
 * Cancels the container chrome on the outer sonner `<li>` for custom toasts.
 *
 * sonner applies the `<Toaster>` `toastOptions.className` (TOAST_SHELL_CLASS) to
 * every toast's outer `<li>` — even `unstyled` ones; `unstyled` only gates
 * sonner's own CSS, not the user className. Custom toasts render their own
 * rounded `ToastShell`, so the `<li>`'s square (non-rounded) border, background,
 * and shadow peek out behind the card as a faint extra border. Passing this as
 * the custom toast's `className` neutralizes that inherited chrome (important
 * modifiers win deterministically regardless of stylesheet order), leaving the
 * inner `ToastShell` as the only visible card edge.
 */
export const TOAST_UNSTYLED_RESET_CLASS =
  "!border-0 !bg-transparent !shadow-none";

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
