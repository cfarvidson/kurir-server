/**
 * Coalesced on-demand IMAP check (kurir-server#162).
 *
 * Window-focus, Cmd+R, pull-to-refresh, the sidebar indicator, the command
 * palette, and the error-banner Retry all funnel through one trigger: if the tab is visible,
 * POST /api/mail/check (cheap IDLE lastUid ingest, not full sync), then
 * schedule the existing UI refresh. A burst collapses to one IMAP call and
 * one refresh. Hidden tabs do not fetch. 429 still schedules a UI refresh
 * so IDLE-ingested mail can appear.
 *
 * Pure and DOM-free except `requestImapCheck` (fetch) and `requestMailCheck`
 * (window event). Visibility and the refresh callback are injected.
 */

export type CheckResult = "ok" | "rate_limited" | "error";

export const MAIL_CHECK_EVENT = "mail-check";

export async function requestImapCheck(): Promise<CheckResult> {
  try {
    const res = await fetch("/api/mail/check", { method: "POST" });
    if (res.status === 429) return "rate_limited";
    if (!res.ok) return "error";
    return "ok";
  } catch {
    return "error";
  }
}

/** Dispatch from sidebar, palette, Cmd+R, pull-to-refresh, and useSync retry. */
export function requestMailCheck() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAIL_CHECK_EVENT));
}

let checking = false;
const checkingListeners = new Set<() => void>();

function setCheckInFlight(value: boolean) {
  if (checking === value) return;
  checking = value;
  for (const listener of checkingListeners) listener();
}

export function isCheckInFlight(): boolean {
  return checking;
}

export function subscribeCheckInFlight(listener: () => void): () => void {
  checkingListeners.add(listener);
  return () => {
    checkingListeners.delete(listener);
  };
}

export interface CheckTrigger {
  trigger: () => void;
  cancel: () => void;
}

interface CheckTriggerOptions {
  isVisible: () => boolean;
  requestCheck: () => Promise<CheckResult>;
  scheduleRefresh: () => void;
}

export function createCheckTrigger(opts: CheckTriggerOptions): CheckTrigger {
  const { isVisible, requestCheck, scheduleRefresh } = opts;

  let inFlight = false;
  let cancelled = false;

  const notify = (value: boolean) => {
    setCheckInFlight(value);
  };

  const trigger = () => {
    if (cancelled || !isVisible()) return;
    // Join an in-flight check rather than stacking another IMAP POST.
    if (inFlight) return;

    inFlight = true;
    notify(true);

    void (async () => {
      try {
        if (isVisible()) {
          await requestCheck();
        }
      } catch {
        // requestCheck maps failures; still refresh in finally.
      } finally {
        inFlight = false;
        notify(false);
        if (!cancelled) scheduleRefresh();
      }
    })();
  };

  const cancel = () => {
    cancelled = true;
    inFlight = false;
    notify(false);
  };

  return { trigger, cancel };
}

export interface SyncShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Cmd+R / Ctrl+R is Sync. Always preventDefault so the browser does not
 * reload a mail page. Do not fire the check while typing in an input so a
 * compose draft is not refreshed out from under the user.
 */
export function handleSyncShortcut(
  event: SyncShortcutEvent,
  onSync: () => void,
): boolean {
  if (event.key.toLowerCase() !== "r") return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;

  event.preventDefault();
  if (isTypingTarget(event.target)) return true;
  onSync();
  return true;
}
