const FALLBACK_HEX = "#737373";

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

/**
 * Whether text on a solid fill of this color should be light or dark.
 * YIQ perceived brightness, not the WCAG crossover: pure contrast math
 * puts black text on saturated mid tones like emerald-600 where every
 * design convention (and the eye) wants white. Threshold 150 keeps
 * white text on those mid fills.
 */
export function readableTextTone(hex: string): "light" | "dark" {
  const normalized = normalizeEventHex(hex);
  const yiq =
    (parseInt(normalized.slice(1, 3), 16) * 299 +
      parseInt(normalized.slice(3, 5), 16) * 587 +
      parseInt(normalized.slice(5, 7), 16) * 114) /
    1000;
  return yiq > 150 ? "dark" : "light";
}
