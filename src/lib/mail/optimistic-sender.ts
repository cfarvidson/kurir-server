/**
 * Shared optimistic-action flow for screener / sender controls.
 *
 * Screener approve/reject/skip and category moves previously awaited the server
 * action and then called `router.refresh()` before the row changed — locking the
 * list behind a full RSC round-trip. This helper applies the optimistic UI
 * change immediately (remove the row / swap the category), fires the action
 * without blocking, reconciles with the server on settle, and reverts + surfaces
 * an error toast if the action fails.
 *
 * Pure and injectable (toast/onError overridable) so it is unit-testable in the
 * `node` Vitest environment without a DOM.
 */

import { toast } from "sonner";

export interface OptimisticSenderActionOptions {
  /** The server action to fire (already bound to its arguments). */
  action: () => Promise<unknown>;
  /** Apply the optimistic UI change now (e.g. hide the row, swap category). */
  applyOptimistic: () => void;
  /** Undo the optimistic change when the action fails. */
  revert: () => void;
  /** Re-sync with the server (invalidate queries + router.refresh). */
  reconcile: () => void;
  /** Error toast label shown when the action rejects. */
  errorLabel: string;
  /** Override for tests; defaults to `console.error`. */
  onError?: (err: unknown) => void;
  /** Override for tests; defaults to the real `toast.error`. */
  toastError?: typeof toast.error;
}

/**
 * Run a sender action optimistically. Returns a settled-handling promise that
 * never rejects, so callers/tests can chain on completion.
 */
export function runOptimisticSenderAction(
  opts: OptimisticSenderActionOptions,
): Promise<unknown> {
  const {
    action,
    applyOptimistic,
    revert,
    reconcile,
    errorLabel,
    onError = console.error,
  } = opts;
  const toastError = opts.toastError ?? toast.error;

  applyOptimistic();

  return action().then(
    () => {
      reconcile();
    },
    (err) => {
      onError(err);
      revert();
      toastError(errorLabel);
      reconcile();
    },
  );
}
