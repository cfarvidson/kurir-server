"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { rsvpAction } from "@/actions/calendar";
import { Button } from "@/components/ui/button";
import type { RsvpStatus } from "@/lib/calendar/rsvp";
import {
  meetingCardState,
  meetingDayHref,
  meetingOrganizerLabel,
  meetingWhenLabel,
  type MeetingCardMeeting,
  type MeetingRsvpResponse,
} from "@/lib/calendar/meeting-card";

const RESPONSE_LABEL: Record<MeetingRsvpResponse, string> = {
  accepted: "Accepted",
  tentative: "Maybe",
  declined: "Declined",
};

export function MeetingCard({
  messageId,
  meeting,
  hasWritableCalendar,
  timezone,
}: {
  messageId: string;
  meeting: MeetingCardMeeting;
  hasWritableCalendar: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const state = meetingCardState(
    meeting.method,
    hasWritableCalendar,
    meeting.response,
  );
  const organizer = meetingOrganizerLabel(
    meeting.organizerName,
    meeting.organizerEmail,
  );
  const when = meetingWhenLabel(
    meeting.startAt,
    meeting.endAt,
    meeting.isAllDay,
    timezone,
  );
  const calendarHref =
    meeting.calendarEventId &&
    meetingDayHref(meeting.startAt, meeting.isAllDay, timezone);

  function rsvp(status: RsvpStatus) {
    startTransition(async () => {
      try {
        await rsvpAction(messageId, status);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not send RSVP",
        );
      }
    });
  }

  return (
    <section className="mt-4 rounded-md border border-border/50 bg-muted/30 px-3 py-3">
      <p className="text-sm font-semibold leading-snug tracking-tight text-foreground">
        {meeting.title}
      </p>
      {when && (
        <p className="mt-1 text-sm tabular-nums text-muted-foreground">{when}</p>
      )}
      {meeting.location && (
        <p className="mt-0.5 text-sm text-muted-foreground">{meeting.location}</p>
      )}
      {organizer && (
        <p className="mt-0.5 text-sm text-muted-foreground">{organizer}</p>
      )}
      {state.cancelled && (
        <p className="mt-2 text-sm text-muted-foreground">
          This meeting was cancelled.
        </p>
      )}
      {state.disabledReason && (
        <p className="mt-2 text-sm text-muted-foreground">
          {state.disabledReason}
        </p>
      )}
      {meeting.response && !state.cancelled && (
        <p className="mt-2 text-sm text-muted-foreground">
          {RESPONSE_LABEL[meeting.response]}
        </p>
      )}
      {calendarHref && (
        <p className="mt-2">
          <Link
            href={calendarHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Show in calendar
          </Link>
        </p>
      )}
      {state.showButtons && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={isPending}
            aria-pressed={meeting.response === "accepted"}
            onClick={() => rsvp("accepted")}
          >
            Accept
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            aria-pressed={meeting.response === "tentative"}
            onClick={() => rsvp("tentative")}
          >
            Maybe
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            aria-pressed={meeting.response === "declined"}
            onClick={() => rsvp("declined")}
          >
            Decline
          </Button>
        </div>
      )}
    </section>
  );
}
