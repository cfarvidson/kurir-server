"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FILE_GROUPS,
  FILE_GROUP_LABEL,
  type FileGroup,
} from "@/lib/mail/file-types";

const TABS: { value: FileGroup | null; label: string }[] = [
  { value: null, label: "All" },
  ...FILE_GROUPS.map((g) => ({ value: g, label: FILE_GROUP_LABEL[g] })),
  { value: "other" as FileGroup, label: FILE_GROUP_LABEL.other },
];

/**
 * Tab bar that filters the Files library by type group via the `?type=` query
 * param, preserving any active `?q=` search.
 */
export function FileTypeFilter({ active }: { active: FileGroup | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get("q");

  function hrefFor(value: FileGroup | null): string {
    const params = new URLSearchParams();
    if (value) params.set("type", value);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.label}
            href={hrefFor(tab.value)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 pb-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
