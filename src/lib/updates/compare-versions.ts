// Client-safe: imported by the admin Updates page, so no db/server imports.

/**
 * Compare two CalVer strings component by component, padding the shorter one
 * with zeroes. Returns -1 if a < b, 0 if equal, 1 if a > b.
 *
 * The `YYYY.MM.N` -> `YYYY.MICRO` crossover needs no special case here: the
 * first micro was picked to outrank the last month component, so
 * `2026.08.27` < `2026.28` is just `8 < 28` on the second component. That is
 * also why a micro cannot restart at 1 mid-year.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}
