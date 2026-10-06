import ICAL from "ical.js";

/**
 * Travel time before an event, as Apple Calendar keeps it on the VEVENT:
 * `X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M` is the length, and other
 * `X-APPLE-TRAVEL-*` lines say where it was counted from
 * (`X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-ADDRESS="...";X-TITLE=Home:`)
 * and the like. Kurir reads the length into minutes and keeps the other
 * lines as content lines, written back the way Apple writes them.
 */
export type Travel = {
  travelMinutes: number | null;
  travelExtra: string[];
};

/** Where the travel starts: a place's name and its address, one line per address line. */
export type TravelStart = {
  title: string | null;
  address: string | null;
};

export const NO_TRAVEL: Travel = { travelMinutes: null, travelExtra: [] };

/** The longest travel time Kurir reads or writes: a day. Anything longer reads as none. */
export const MAX_TRAVEL_MINUTES = 24 * 60;

const PREFIX = "x-apple-travel-";
const DURATION = "x-apple-travel-duration";
const START = "x-apple-travel-start";

/**
 * A remote value made safe to write inside one content line. A CR, LF or
 * other control character would end the line, and whatever followed it -
 * say an ATTENDEE - would become a property of the event Kurir writes back.
 */
function oneLine(value: string): string {
  return value.replace(/\r\n/g, " ").replace(/[\x00-\x1f\x7f]/g, " ");
}

/**
 * Apple quotes addresses and names and writes their line breaks as `\n`;
 * plain words stay bare. Any other control character becomes a space.
 */
function paramValue(value: string): string {
  if (/^[A-Za-z0-9\-_./]+$/.test(value)) return value;
  const text = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(oneLine)
    .join("\\n")
    .replace(/"/g, "");
  return `"${text}"`;
}

/** A property value for the line: TEXT escaped as RFC 5545 has it, anything else kept on one line. */
function propertyValue(prop: ICAL.Property): string {
  const value = prop.getFirstValue();
  if (value == null) return "";
  if (prop.type !== "text") return oneLine(String(value));
  return oneLine(
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n"),
  );
}

/**
 * One property as an unfolded content line in Apple's form. ical.js would
 * write `X-ADDRESS=Storgatan 1^n111 22 Stockholm` (RFC 6868), which is not
 * what Apple wrote or reads back.
 */
function contentLine(prop: ICAL.Property): string {
  const params = Object.entries(
    prop.toJSON()[1] as Record<string, string | string[]>,
  )
    .filter(([key]) => key !== "value")
    .map(([key, raw]) => {
      const values = Array.isArray(raw) ? raw : [raw];
      return `${key.toUpperCase()}=${values.map(paramValue).join(",")}`;
    });
  // ical.js keeps VALUE as the property's type. Apple writes it after ROUTING.
  if (prop.type !== "unknown") {
    const at = params.findIndex((p) => p.startsWith("ROUTING=")) + 1;
    params.splice(at, 0, `VALUE=${prop.type.toUpperCase()}`);
  }
  return `${[prop.name.toUpperCase(), ...params].join(";")}:${propertyValue(prop)}`;
}

/**
 * Whole minutes, or null for a length no calendar means: negative, zero,
 * over a day, or unreadable. ical.js decodes the value when it is first
 * read and throws on garbage, so the read happens in here.
 */
function minutesOf(prop: ICAL.Property | null): number | null {
  if (!prop) return null;
  try {
    const value = prop.getFirstValue();
    const duration =
      value instanceof ICAL.Duration
        ? value
        : ICAL.Duration.fromString(String(value ?? "").trim());
    if (duration.isNegative) return null;
    const minutes = Math.floor(duration.toSeconds() / 60);
    return minutes > 0 && minutes <= MAX_TRAVEL_MINUTES ? minutes : null;
  } catch {
    return null;
  }
}

/** The travel lines on a VEVENT, whatever kind of event it is. A line ical.js cannot decode is left out. */
function travelLinesOf(vevent: ICAL.Component): Travel {
  const travelMinutes = minutesOf(vevent.getFirstProperty(DURATION));
  const travelExtra: string[] = [];
  for (const prop of vevent.getAllProperties()) {
    if (!prop.name.startsWith(PREFIX) || prop.name === DURATION) continue;
    try {
      travelExtra.push(contentLine(prop));
    } catch {
      // Unreadable: dropped rather than failing the event.
    }
  }
  if (travelMinutes == null && travelExtra.length === 0) return NO_TRAVEL;
  return { travelMinutes, travelExtra };
}

/** The travel time on a VEVENT. An all-day event has none. */
export function readTravel(vevent: ICAL.Component): Travel {
  const start = vevent.getFirstPropertyValue("dtstart");
  if (start && typeof start === "object" && (start as ICAL.Time).isDate) {
    return NO_TRAVEL;
  }
  return travelLinesOf(vevent);
}

function isStartLine(line: string): boolean {
  return line.toLowerCase().startsWith(START);
}

/** Where the travel starts, from an event's other travel lines. */
export function travelStart(lines: string[]): TravelStart | null {
  const line = lines.find(isStartLine);
  if (!line) return null;
  try {
    const prop = ICAL.Property.fromString(line);
    const param = (name: string) => {
      const value = prop.getParameter(name);
      const text = Array.isArray(value) ? value.join(",") : value;
      return text?.trim() ? text : null;
    };
    return {
      title: param("x-title"),
      // ical.js already turns Apple's `\n` into line breaks; RFC 6868 `^n` too.
      address: param("x-address")?.replace(/\\n/g, "\n") ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The travel an event gets from an edit. `undefined` minutes leaves it as it
 * was (a drag, or a client that does not know travel time); null or 0 is
 * None and removes every line. The same length keeps everything. A new
 * length drops the start line, which no longer applies, and keeps the rest.
 */
export function nextTravel(
  current: Travel,
  minutes: number | null | undefined,
  isAllDay: boolean,
): Travel {
  if (isAllDay) return NO_TRAVEL;
  if (minutes === undefined) return current;
  if (!minutes || minutes <= 0) return NO_TRAVEL;
  if (minutes === current.travelMinutes) return current;
  return {
    travelMinutes: minutes,
    travelExtra: current.travelExtra.filter((line) => !isStartLine(line)),
  };
}

/** `PT1H30M` for 90, `PT1H` for 60, `PT30M` for 30. */
export function travelDurationValue(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `PT${rest}M`;
  if (rest === 0) return `PT${hours}H`;
  return `PT${hours}H${rest}M`;
}

function sameTravel(a: Travel, b: Travel): boolean {
  return (
    a.travelMinutes === b.travelMinutes &&
    a.travelExtra.length === b.travelExtra.length &&
    a.travelExtra.every((line, i) => line === b.travelExtra[i])
  );
}

/** Replace every travel line on the VEVENT with `travel`. A no-op when nothing changes. */
export function writeTravel(vevent: ICAL.Component, travel: Travel): void {
  if (sameTravel(travelLinesOf(vevent), travel)) return;
  for (const prop of [...vevent.getAllProperties()]) {
    if (prop.name.startsWith(PREFIX)) vevent.removeProperty(prop);
  }
  if (travel.travelMinutes) {
    vevent.addProperty(
      ICAL.Property.fromString(
        `X-APPLE-TRAVEL-DURATION;VALUE=DURATION:${travelDurationValue(travel.travelMinutes)}`,
      ),
    );
  }
  for (const line of travel.travelExtra) {
    try {
      vevent.addProperty(ICAL.Property.fromString(line));
    } catch {
      // A line ical.js cannot read back is dropped, not fatal to the write.
    }
  }
}

/**
 * Serialized ICS with each `X-APPLE-TRAVEL-*` line rewritten in Apple's form.
 * Every CalDAV write goes through ical.js, which re-encodes parameters.
 * Other lines, folded or not, stay exactly as they were.
 */
export function appleTravelLines(ics: string): string {
  if (!/X-APPLE-TRAVEL-/i.test(ics)) return ics;
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  // Each content line with its folded continuations.
  const lines: string[] = [];
  for (const raw of ics.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) {
      lines[lines.length - 1] += eol + raw;
    } else {
      lines.push(raw);
    }
  }
  return lines
    .map((line) => {
      if (!line.toLowerCase().startsWith(PREFIX)) return line;
      try {
        const unfolded = line.replace(/\r?\n[ \t]/g, "");
        return ICAL.helpers
          .foldline(contentLine(ICAL.Property.fromString(unfolded)))
          .replace(/\r?\n/g, eol);
      } catch {
        return oneLine(line);
      }
    })
    .join(eol);
}
