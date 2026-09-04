import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCheckTrigger,
  requestImapCheck,
  isCheckInFlight,
  subscribeCheckInFlight,
  type CheckResult,
} from "@/lib/mail/check-trigger";

/**
 * On-demand IMAP check trigger (kurir-server#162).
 *
 * Visible vs hidden, coalesced "please check IMAP then refresh" bursts, and
 * 429 still scheduling a UI refresh. DOM-free: visibility and fetch are
 * injected, matching refresh-scheduler.test.ts.
 */

describe("requestImapCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /api/mail/check and returns ok on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestImapCheck()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith("/api/mail/check", {
      method: "POST",
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/mail/sync",
      expect.anything(),
    );
  });

  it("returns rate_limited on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    await expect(requestImapCheck()).resolves.toBe("rate_limited");
  });

  it("returns error on a non-OK, non-429 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    await expect(requestImapCheck()).resolves.toBe("error");
  });

  it("returns error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(requestImapCheck()).resolves.toBe("error");
  });
});

describe("createCheckTrigger", () => {
  let visible: boolean;
  let requestCheck: ReturnType<typeof vi.fn<() => Promise<CheckResult>>>;
  let scheduleRefresh: ReturnType<typeof vi.fn<() => void>>;
  let resolveCheck: ((result: CheckResult) => void) | null;
  let trigger: ReturnType<typeof createCheckTrigger>;

  function pendingCheck(): Promise<CheckResult> {
    return new Promise<CheckResult>((resolve) => {
      resolveCheck = resolve;
    });
  }

  async function settle(result: CheckResult) {
    const pending = requestCheck.mock.results.at(-1)?.value as
      | Promise<CheckResult>
      | undefined;
    resolveCheck?.(result);
    if (pending) await pending;
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    visible = true;
    resolveCheck = null;
    requestCheck = vi.fn(pendingCheck);
    scheduleRefresh = vi.fn<() => void>();
    trigger = createCheckTrigger({
      isVisible: () => visible,
      requestCheck,
      scheduleRefresh,
    });
  });

  afterEach(() => {
    trigger.cancel();
  });

  it("does not fetch or refresh while hidden", () => {
    visible = false;
    trigger.trigger();
    expect(requestCheck).not.toHaveBeenCalled();
    expect(scheduleRefresh).not.toHaveBeenCalled();
    expect(isCheckInFlight()).toBe(false);
  });

  it("checks IMAP then schedules a UI refresh when visible", async () => {
    trigger.trigger();
    expect(requestCheck).toHaveBeenCalledTimes(1);
    expect(scheduleRefresh).not.toHaveBeenCalled();
    expect(isCheckInFlight()).toBe(true);

    await settle("ok");
    expect(scheduleRefresh).toHaveBeenCalledTimes(1);
    expect(isCheckInFlight()).toBe(false);
  });

  it("coalesces a burst of focus + Cmd+R into one IMAP check and one refresh", async () => {
    trigger.trigger();
    trigger.trigger();
    trigger.trigger();

    expect(requestCheck).toHaveBeenCalledTimes(1);
    await settle("ok");
    expect(requestCheck).toHaveBeenCalledTimes(1);
    expect(scheduleRefresh).toHaveBeenCalledTimes(1);
  });

  it("still schedules a UI refresh on 429 without stacking another IMAP call", async () => {
    trigger.trigger();
    trigger.trigger();
    await settle("rate_limited");

    expect(requestCheck).toHaveBeenCalledTimes(1);
    expect(scheduleRefresh).toHaveBeenCalledTimes(1);
    expect(isCheckInFlight()).toBe(false);
  });

  it("still schedules a UI refresh when the check errors", async () => {
    trigger.trigger();
    await settle("error");
    expect(scheduleRefresh).toHaveBeenCalledTimes(1);
  });

  it("allows a later trigger after the first check settles", async () => {
    trigger.trigger();
    await settle("ok");
    trigger.trigger();
    expect(requestCheck).toHaveBeenCalledTimes(2);
    await settle("ok");
    expect(scheduleRefresh).toHaveBeenCalledTimes(2);
  });

  it("notifies in-flight subscribers while a check is running", async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeCheckInFlight(() => {
      seen.push(isCheckInFlight());
    });

    trigger.trigger();
    expect(seen).toEqual([true]);
    await settle("ok");
    expect(seen).toEqual([true, false]);
    unsubscribe();
  });

  it("cancel() drops a pending refresh", async () => {
    trigger.trigger();
    trigger.cancel();
    await settle("ok");
    expect(scheduleRefresh).not.toHaveBeenCalled();
    expect(isCheckInFlight()).toBe(false);
  });
});
