import nodemailer from "nodemailer";
import {
  buildSmtpAuth,
  type ConnectionCredentials,
} from "@/lib/mail/auth-helpers";

export type ItipReplyStatus = "accepted" | "tentative" | "declined";

export type ItipReplyInput = {
  uid: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  isAllDay: boolean;
  organizerEmail: string;
  attendeeEmail: string;
  status: ItipReplyStatus;
  recurrenceId?: Date | null;
  sequence?: number;
  organizerName?: string | null;
};

const PARTSTAT: Record<ItipReplyStatus, string> = {
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

const STATUS_LABEL: Record<ItipReplyStatus, string> = {
  accepted: "Accepted",
  tentative: "Tentative",
  declined: "Declined",
};

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dtLine(name: string, date: Date, isAllDay: boolean): string {
  if (isAllDay) return `${name};VALUE=DATE:${compactDate(date)}`;
  return `${name}:${compactUtc(date)}`;
}

/** Build a METHOD:REPLY VCALENDAR. Used by SMTP; not persisted to Sent. */
export function buildItipReply(input: ItipReplyInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kurir//Calendar//EN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${compactUtc(new Date())}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `SUMMARY:${escapeText(input.title)}`,
  ];

  if (input.startAt) lines.push(dtLine("DTSTART", input.startAt, input.isAllDay));
  if (input.endAt) lines.push(dtLine("DTEND", input.endAt, input.isAllDay));
  if (input.recurrenceId) {
    lines.push(dtLine("RECURRENCE-ID", input.recurrenceId, input.isAllDay));
  }

  const organizer =
    input.organizerName && input.organizerName.trim()
      ? `ORGANIZER;CN=${escapeText(input.organizerName)}:mailto:${input.organizerEmail}`
      : `ORGANIZER:mailto:${input.organizerEmail}`;
  lines.push(organizer);
  lines.push(
    `ATTENDEE;PARTSTAT=${PARTSTAT[input.status]}:mailto:${input.attendeeEmail}`,
  );
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Send an iTIP REPLY over SMTP using the same credentials as compose.
 * Does not call sendMailForUser and does not write a Sent message.
 */
export async function sendItipReply(
  credentials: ConnectionCredentials,
  input: ItipReplyInput,
): Promise<void> {
  const ics = buildItipReply(input);
  const transporter = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.port === 465,
    auth: buildSmtpAuth(credentials),
  });
  const fromAddress = credentials.sendAsEmail || credentials.email;
  const label = STATUS_LABEL[input.status];
  await transporter.sendMail({
    from: fromAddress,
    to: input.organizerEmail,
    subject: `${label}: ${input.title}`,
    text: `${label}: ${input.title}`,
    icalEvent: {
      method: "REPLY",
      filename: "reply.ics",
      content: ics,
    },
  });
}
