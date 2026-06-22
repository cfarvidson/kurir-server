import { describe, it, expect, vi } from "vitest";
import { runOptimisticSenderAction } from "@/lib/mail/optimistic-sender";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runOptimisticSenderAction", () => {
  it("applies the optimistic change immediately, before the action resolves", () => {
    const applyOptimistic = vi.fn();
    const d = deferred<void>();

    runOptimisticSenderAction({
      action: () => d.promise,
      applyOptimistic,
      revert: vi.fn(),
      reconcile: vi.fn(),
      errorLabel: "nope",
      toastError: vi.fn(),
    });

    expect(applyOptimistic).toHaveBeenCalledTimes(1);
  });

  it("reconciles on success and does not revert or toast", async () => {
    const revert = vi.fn();
    const reconcile = vi.fn();
    const toastError = vi.fn();

    await runOptimisticSenderAction({
      action: () => Promise.resolve(),
      applyOptimistic: vi.fn(),
      revert,
      reconcile,
      errorLabel: "nope",
      toastError,
    });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("on error: reverts, shows the error toast, reconciles, and never rejects", async () => {
    const order: string[] = [];
    const applyOptimistic = vi.fn(() => order.push("apply"));
    const revert = vi.fn(() => order.push("revert"));
    const reconcile = vi.fn(() => order.push("reconcile"));
    const toastError = vi.fn(() => order.push("toast"));
    const onError = vi.fn();

    const settled = runOptimisticSenderAction({
      action: () => Promise.reject(new Error("boom")),
      applyOptimistic,
      revert,
      reconcile,
      errorLabel: "Couldn't move sender — please try again",
      onError,
      toastError,
    });

    await expect(settled).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't move sender — please try again",
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
    // Optimistic change is applied first; revert + reconcile happen after failure.
    expect(order).toEqual(["apply", "revert", "toast", "reconcile"]);
  });
});
