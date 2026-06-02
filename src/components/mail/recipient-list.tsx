"use client";

import { useState } from "react";
import {
  resolveRecipientName,
  type RecipientNameMap,
} from "@/lib/mail/recipient-names";

const TRUNCATE_AT = 3;

interface RecipientListProps {
  /** Lowercase label shown before the names, e.g. "to" or "cc". */
  label: string;
  addresses: string[];
  nameMap: RecipientNameMap;
}

/**
 * Renders recipients as contact names (falling back to raw addresses),
 * joined inline. Beyond TRUNCATE_AT recipients it shows a "+N more" toggle
 * that expands the full list and collapses back.
 */
export function RecipientList({ label, addresses, nameMap }: RecipientListProps) {
  const [expanded, setExpanded] = useState(false);

  if (addresses.length === 0) return null;

  const names = addresses.map((a) => resolveRecipientName(a, nameMap));
  const overflow = names.length - TRUNCATE_AT;
  const visible = expanded ? names : names.slice(0, TRUNCATE_AT);

  return (
    <span>
      {label} {visible.join(", ")}
      {overflow > 0 && (
        <>
          {!expanded && " "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-primary hover:underline"
          >
            {expanded ? "show less" : `+${overflow} more`}
          </button>
        </>
      )}
    </span>
  );
}
