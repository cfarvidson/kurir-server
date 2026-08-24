import ICAL from "ical.js";
import {
  fetchIcsFeed,
  parseIcsCalendarName,
} from "@/lib/calendar/ics-url";
import { mapCalDavVevent } from "./map-caldav";
import type {
  CalendarAdapter,
  PullResult,
  RemoteCalendar,
  RemoteEvent,
} from "./types";

const READ_ONLY = "Calendar is read-only";

async function refuseWrite(): Promise<never> {
  throw new Error(READ_ONLY);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function icsProviderId(event: RemoteEvent): string {
  const uid = event.icalUid ?? event.providerEventId;
  if (!event.recurrenceId) return uid;
  return `${uid}#${event.recurrenceId.toISOString()}`;
}

function mapFeed(body: string): RemoteEvent[] {
  const vcalendar = new ICAL.Component(ICAL.parse(body));
  ICAL.helpers.updateTimezones(vcalendar);
  const events: RemoteEvent[] = [];
  for (const vevent of vcalendar.getAllSubcomponents("vevent")) {
    try {
      const mapped = mapCalDavVevent(vevent);
      events.push({ ...mapped, providerEventId: icsProviderId(mapped) });
    } catch (err) {
      const uid = vevent.getFirstPropertyValue("uid");
      console.warn(
        `[ics] Skipping ${String(uid ?? "unknown")}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return events;
}

export function createIcsAdapter(input: { url: string }): CalendarAdapter {
  let cached: {
    body: string;
    etag: string | null;
    lastModified: string | null;
  } | null = null;

  async function load(etag: string | null): Promise<{
    status: number;
    body: string;
    etag: string | null;
    lastModified: string | null;
  }> {
    if (cached) return { status: 200, ...cached };
    const fetched = await fetchIcsFeed(input.url, {
      etag,
      lastModified: null,
    });
    if (fetched.status !== 304) {
      cached = {
        body: fetched.body,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      };
    }
    return fetched;
  }

  return {
    async listCalendars(): Promise<RemoteCalendar[]> {
      const fetched = await load(null);
      return [
        {
          providerCalendarId: input.url,
          name: parseIcsCalendarName(fetched.body, hostOf(input.url)),
          color: null,
          isPrimary: true,
          isReadOnly: true,
          timezone: null,
        },
      ];
    },

    async pull(
      calendar: { providerCalendarId: string; syncToken: string | null },
      _cursor: string | null,
    ): Promise<PullResult> {
      const fetched = await load(calendar.syncToken);
      if (fetched.status === 304) {
        return {
          upserts: [],
          deletedProviderIds: [],
          cursor: calendar.syncToken,
          reset: false,
          complete: true,
        };
      }
      return {
        upserts: mapFeed(fetched.body),
        deletedProviderIds: [],
        cursor: fetched.etag ?? fetched.lastModified,
        reset: true,
        complete: true,
      };
    },

    createEvent: refuseWrite,
    getEvent: refuseWrite,
    moveEvent: refuseWrite,
    updateEvent: refuseWrite,
    deleteEvent: refuseWrite,
    respond: refuseWrite,
  };
}
