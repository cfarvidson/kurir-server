/**
 * Rows for the labels under the day ribbon. Labels are placed left to
 * right; each goes in the first row where it clears the previous label by
 * `gap` px, so neighbours that would collide stagger downwards. A label no
 * row has room for within `maxRows` is hidden (null) rather than written
 * over another: its event is still in the ribbon and in the Scheduled list.
 */
export function staggerRows(
  labels: { x: number; width: number }[],
  maxRows = 3,
  gap = 10,
): (number | null)[] {
  const order = labels
    .map((label, index) => ({ ...label, index }))
    .sort((a, b) => a.x - b.x || a.index - b.index);
  const rowEnds: number[] = [];
  const rows = new Array<number | null>(labels.length).fill(null);
  for (const label of order) {
    let row = rowEnds.findIndex((end) => end + gap <= label.x);
    if (row === -1) {
      if (rowEnds.length === maxRows) continue;
      row = rowEnds.length;
    }
    rowEnds[row] = label.x + label.width;
    rows[label.index] = row;
  }
  return rows;
}
