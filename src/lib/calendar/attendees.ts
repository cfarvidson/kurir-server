/**
 * Providers store attendees in their own shapes (Google, Microsoft Graph,
 * CalDAV). Native clients get one normalized list instead of three.
 * Status reuses the same PARTSTAT mapping the meeting card uses, so an
 * invitation and its calendar event can never disagree.
 */

export type CalendarAttendeeStatus =
  | "accepted"
  | "tentative"
  | "declined"
  | "needsAction";

export type CalendarAttendeeDTO = {
  email: string;
  name: string | null;
  status: CalendarAttendeeStatus | null;
  isSelf: boolean;
};

const PARTSTAT: Record<string, CalendarAttendeeStatus> = {
  ACCEPTED: "accepted",
  accepted: "accepted",
  TENTATIVE: "tentative",
  tentative: "tentative",
  tentativelyAccepted: "tentative",
  DECLINED: "declined",
  declined: "declined",
  "NEEDS-ACTION": "needsAction",
  needsAction: "needsAction",
  notResponded: "needsAction",
};

function statusOf(row: Record<string, unknown>): CalendarAttendeeStatus | null {
  const flat = row.partstat ?? row.responseStatus;
  if (typeof flat === "string") {
    return PARTSTAT[flat] ?? PARTSTAT[flat.toUpperCase()] ?? null;
  }
  const nested = row.status;
  if (nested && typeof nested === "object" && "response" in nested) {
    const value = (nested as { response: unknown }).response;
    if (typeof value === "string") {
      return PARTSTAT[value] ?? PARTSTAT[value.toUpperCase()] ?? null;
    }
  }
  return null;
}

function emailOf(row: Record<string, unknown>): string | null {
  if (typeof row.email === "string" && row.email.trim()) {
    return row.email.trim();
  }
  const nested = row.emailAddress;
  if (nested && typeof nested === "object") {
    const address = (nested as { address?: unknown }).address;
    if (typeof address === "string" && address.trim()) return address.trim();
  }
  // CalDAV: "mailto:erik@example.com"
  if (typeof row.value === "string" && row.value.trim()) {
    return row.value.trim().replace(/^mailto:/i, "");
  }
  return null;
}

function nameOf(row: Record<string, unknown>): string | null {
  const candidates = [row.displayName, row.cn];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const nested = row.emailAddress;
  if (nested && typeof nested === "object") {
    const name = (nested as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

/** Never throws: an unrecognized shape yields an empty list. */
export function normalizeAttendees(
  attendeesJson: unknown,
): CalendarAttendeeDTO[] {
  if (!Array.isArray(attendeesJson)) return [];
  const out: CalendarAttendeeDTO[] = [];
  for (const raw of attendeesJson) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const email = emailOf(row);
    if (!email) continue;
    out.push({
      email,
      name: nameOf(row),
      status: statusOf(row),
      isSelf: row.self === true,
    });
  }
  return out;
}
