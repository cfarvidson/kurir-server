"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CalDavDialog } from "@/components/calendar/caldav-dialog";
import { IcsDialog } from "@/components/calendar/ics-dialog";

const GOOGLE_HREF = "/api/calendar/oauth/start?provider=google&redirect=/calendar";
const OUTLOOK_HREF =
  "/api/calendar/oauth/start?provider=microsoft&redirect=/calendar";

export function CalendarEmpty() {
  const [caldavOpen, setCaldavOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h2 className="font-serif text-title text-foreground">
        Connect a calendar
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Google, Outlook, CalDAV, or a calendar URL. Events stay on that
        calendar. Kurir shows this week.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <a href={GOOGLE_HREF}>Add Google</a>
        </Button>
        <Button asChild variant="outline">
          <a href={OUTLOOK_HREF}>Add Outlook</a>
        </Button>
        <Button type="button" variant="outline" onClick={() => setCaldavOpen(true)}>
          Add CalDAV
        </Button>
        <Button type="button" variant="outline" onClick={() => setIcsOpen(true)}>
          Add calendar URL
        </Button>
      </div>
      <CalDavDialog open={caldavOpen} onOpenChange={setCaldavOpen} />
      <IcsDialog open={icsOpen} onOpenChange={setIcsOpen} />
    </div>
  );
}
