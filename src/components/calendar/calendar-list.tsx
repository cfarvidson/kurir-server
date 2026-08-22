"use client";

import { useRouter } from "next/navigation";
import { setCalendarVisibleAction } from "@/actions/calendar";
import { normalizeEventHex } from "@/lib/calendar/color";
import { cn } from "@/lib/utils";
import type { CalendarAccountDTO } from "@/components/calendar/types";

export function CalendarList({
  accounts,
  className,
  showAccountHeading = true,
}: {
  accounts: CalendarAccountDTO[];
  className?: string;
  showAccountHeading?: boolean;
}) {
  const router = useRouter();

  async function toggle(calendarId: string, isVisible: boolean) {
    await setCalendarVisibleAction(calendarId, isVisible);
    router.refresh();
  }

  return (
    <div className={cn("space-y-5", className)}>
      {accounts.map((account) => (
        <div key={account.id}>
          {showAccountHeading && (
            <p className="px-1 text-xs font-medium text-muted-foreground">
              {account.displayName}
            </p>
          )}
          <ul className={cn("space-y-0.5", showAccountHeading && "mt-1.5")}>
            {account.calendars.map((calendar) => (
              <li key={calendar.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 shrink-0 accent-primary"
                    checked={calendar.isVisible}
                    onChange={(e) => toggle(calendar.id, e.target.checked)}
                  />
                  <span
                    aria-hidden
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: normalizeEventHex(calendar.color),
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {calendar.name}
                    </span>
                    {calendar.isReadOnly && (
                      <span className="block text-xs text-muted-foreground">
                        Subscribe
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
