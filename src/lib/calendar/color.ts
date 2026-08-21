const FALLBACK_HEX = "#737373";

export type EventBlockStyle = {
  "--event-color": string;
  "--event-fill": string;
};

function expandShortHex(hex: string): string {
  if (hex.length !== 4) return hex;
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

export function normalizeEventHex(hex: string | null | undefined): string {
  const raw = hex?.trim() ?? "";
  if (!raw) return FALLBACK_HEX;
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  const lower = withHash.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(lower)) return expandShortHex(lower);
  if (/^#[0-9a-f]{6}$/.test(lower)) return lower;
  return FALLBACK_HEX;
}

export function eventBlockStyle(hex: string): EventBlockStyle {
  return {
    "--event-color": normalizeEventHex(hex),
    "--event-fill":
      "color-mix(in srgb, var(--event-color) 24%, var(--background))",
  };
}
