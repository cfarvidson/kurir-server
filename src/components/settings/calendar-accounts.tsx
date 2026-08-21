"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import {
  disconnectCalendarAccountAction,
  syncCalendarNowAction,
} from "@/actions/calendar";
import { CalendarList } from "@/components/calendar/calendar-list";
import { CalDavDialog } from "@/components/calendar/caldav-dialog";
import type { CalendarListItem } from "@/components/calendar/types";
import { Button } from "@/components/ui/button";
import {
  calendarLastSyncLabel,
  calendarProviderLabel,
  calendarReconnectHref,
  type CalendarProviderId,
} from "@/lib/calendar/settings-display";

export type SettingsCalendarAccount = {
  id: string;
  displayName: string;
  provider: CalendarProviderId;
  principalEmail: string | null;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  oauthError: string | null;
  lastError: string | null;
  calendars: CalendarListItem[];
};

const GOOGLE_HREF = calendarReconnectHref("GOOGLE")!;
const OUTLOOK_HREF = calendarReconnectHref("MICROSOFT")!;

export function CalendarAccounts({
  accounts,
}: {
  accounts: SettingsCalendarAccount[];
}) {
  const [caldavOpen, setCaldavOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <a href={GOOGLE_HREF}>Add Google</a>
        </Button>
        <Button asChild variant="outline">
          <a href={OUTLOOK_HREF}>Add Outlook</a>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setCaldavOpen(true)}
        >
          Add CalDAV
        </Button>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No calendars connected. Events stay on the provider. Kurir shows this
          week.
        </p>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <CalendarAccountCard key={account.id} account={account} />
          ))}
        </div>
      )}

      <CalDavDialog open={caldavOpen} onOpenChange={setCaldavOpen} />
    </div>
  );
}

function CalendarAccountCard({
  account,
}: {
  account: SettingsCalendarAccount;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [caldavOpen, setCaldavOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reconnectHref = calendarReconnectHref(account.provider);
  const errorText = account.oauthError || account.lastError;
  const isBusy = isPending || busy !== null;

  function run(
    status: "sync" | "disconnect",
    action: () => Promise<void>,
    onSuccess?: () => void,
  ) {
    setActionError(null);
    setBusy(status);
    startTransition(async () => {
      try {
        await action();
        onSuccess?.();
        router.refresh();
      } catch (err) {
        setActionError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Please try again.",
        );
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <article
      aria-label={`Calendar account: ${account.displayName}`}
      className="rounded-lg border bg-card"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {calendarProviderLabel(account.provider)}
            {account.principalEmail ? ` · ${account.principalEmail}` : ""}
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {calendarLastSyncLabel(account.lastSyncedAt, account.isSyncing)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isBusy}
            title="Sync this calendar now"
            className="h-8 w-8 text-muted-foreground"
            onClick={() =>
              run("sync", () => syncCalendarNowAction(account.id))
            }
          >
            {busy === "sync" || account.isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {errorText && (
        <div className="flex items-start gap-2 border-t px-4 py-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive" role="alert">
            {errorText}
          </p>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 border-t px-4 py-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive" role="alert">
            {actionError}
          </p>
        </div>
      )}

      {account.calendars.length > 0 && (
        <div className="border-t px-3 py-3">
          <CalendarList
            accounts={[
              {
                id: account.id,
                displayName: account.displayName,
                provider: account.provider,
                oauthError: account.oauthError,
                lastError: account.lastError,
                calendars: account.calendars,
              },
            ]}
            showAccountHeading={false}
          />
        </div>
      )}

      <div className="border-t px-4 py-3">
        {confirmDisconnect ? (
          <div>
            <p className="text-sm font-medium text-destructive">
              Disconnect {account.displayName}?
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Events from this account leave Kurir. They stay on the provider.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={isBusy}
                onClick={() =>
                  run(
                    "disconnect",
                    () => disconnectCalendarAccountAction(account.id),
                    () => setConfirmDisconnect(false),
                  )
                }
              >
                {busy === "disconnect" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Disconnect"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isBusy}
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {reconnectHref ? (
              <Button asChild variant="ghost" size="sm">
                <a href={reconnectHref}>Reconnect</a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCaldavOpen(true)}
              >
                Reconnect
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {account.provider === "CALDAV" && (
        <CalDavDialog open={caldavOpen} onOpenChange={setCaldavOpen} />
      )}
    </article>
  );
}
