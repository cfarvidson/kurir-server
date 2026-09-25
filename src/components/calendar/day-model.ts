/**
 * Rows for the labels under the day ribbon. Labels are placed left to
 * right; each goes in the first row where it clears the previous label by
 * `gap` px, so neighbours that would collide stagger downwards. Past
 * `maxRows` the last row takes the overflow (and may overlap).
 */
export function staggerRows(
  labels: { x: number; width: number }[],
  maxRows = 3,
  gap = 10,
): number[] {
  const order = labels
    .map((label, index) => ({ ...label, index }))
    .sort((a, b) => a.x - b.x || a.index - b.index);
  const rowEnds: number[] = [];
  const rows = new Array<number>(labels.length).fill(0);
  for (const label of order) {
    let row = rowEnds.findIndex((end) => end + gap <= label.x);
    if (row === -1) {
      row = rowEnds.length < maxRows ? rowEnds.length : maxRows - 1;
    }
    rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, label.x + label.width);
    rows[label.index] = row;
  }
  return rows;
}
