const FALLBACK_HEX = "#737373";

/** `#RGB` or `#RGBA` to `#RRGGBB`. The fourth digit is alpha and is dropped. */
function expandShortHex(hex: string): string {
  if (!/^#[0-9a-f]{3,4}$/.test(hex)) return hex;
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

/**
 * A provider hex as six lowercase RGB digits behind a hash, or the fallback.
 *
 * Four forms arrive in practice: `#RGB` and `#RRGGBB` from our own palette,
 * and `#RGBA`/`#RRGGBBAA` from Apple's CalDAV, which reports `calendar-color`
 * with an alpha channel (`#CB30E0FF`). The alpha is dropped rather than
 * honoured - a calendar colour is an identity, not an opacity, and every
 * surface draws it opaque. Rejecting the eight-digit form is what drew every
 * iCloud calendar grey; the apps carry the same rule in CalendarPalette, and
 * the two have to agree or a colour differs between the web and the app.
 */
export function normalizeEventHex(hex: string | null | undefined): string {
  const raw = hex?.trim() ?? "";
  if (!raw) return FALLBACK_HEX;
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  const lower = withHash.toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(lower)) return expandShortHex(lower);
  if (/^#[0-9a-f]{6}$/.test(lower)) return lower;
  if (/^#[0-9a-f]{8}$/.test(lower)) return lower.slice(0, 7);
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
