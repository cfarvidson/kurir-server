/**
 * Client-safe pieces of the Network (kurir-ios#117): the neighbour shape
 * the pane renders and the strength label. No db import here; the
 * computation lives in person-network.ts.
 */

export type NetworkKind = "sharedThread" | "domain";

export interface NetworkNeighbor {
  email: string;
  displayName: string | null;
  kind: NetworkKind;
  strength: number;
  sharedThreads: number;
}

/** Neighbours shown before "Show all". Same as `PersonPane.networkLimit` on iOS. */
export const NETWORK_LIMIT = 8;

/** "12 shared threads", "1 shared thread", or "same domain". */
export function networkStrengthLabel(neighbor: {
  kind: NetworkKind;
  sharedThreads: number;
}): string {
  if (neighbor.kind === "domain" || neighbor.sharedThreads === 0) {
    return "same domain";
  }
  return neighbor.sharedThreads === 1
    ? "1 shared thread"
    : `${neighbor.sharedThreads} shared threads`;
}
