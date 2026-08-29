"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SEARCHABLE_LIST_LABELS,
  type SearchCategory,
} from "@/lib/mail/list-contract";

export function SearchInput({ list }: { list?: SearchCategory }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const thisList = searchParams.get("scope") === "list";

  // Sync input when URL changes externally (browser back/forward),
  // but NOT while the user is actively typing
  useEffect(() => {
    if (!isTypingRef.current) {
      setValue(searchParams.get("q") ?? "");
    }
  }, [searchParams]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Listen for global "/" shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const hrefFor = useCallback(
    (query: string, scoped: boolean) => {
      const params = new URLSearchParams();
      if (query.length >= 2) params.set("q", query);
      if (scoped) params.set("scope", "list");
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname],
  );

  const updateUrl = useCallback(
    (query: string, scoped = thisList) => {
      isTypingRef.current = false;
      router.replace(hrefFor(query, scoped));
    },
    [router, hrefFor, thisList],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    isTypingRef.current = true;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => updateUrl(newValue), 500);
  };

  const handleClear = () => {
    setValue("");
    isTypingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    router.replace(pathname);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClear();
      inputRef.current?.blur();
    }
  };

  const [isFocused, setIsFocused] = useState(false);
  const showChips = Boolean(list) && value.trim().length >= 2;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder={list ? "Search all mail" : "Search..."}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="h-9 w-40 rounded-md border border-border bg-transparent py-1 pl-8 pr-8 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary md:w-56"
        />
        {value ? (
          <button
            onClick={handleClear}
            className="absolute right-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          !isFocused && (
            <kbd className="pointer-events-none absolute right-2.5 hidden select-none rounded border border-input bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-block">
              /
            </kbd>
          )
        )}
      </div>
      {showChips && list && (
        <div className="flex gap-1.5">
          <ScopeChip
            selected={!thisList}
            onClick={() => updateUrl(value, false)}
          >
            All mail
          </ScopeChip>
          <ScopeChip
            selected={thisList}
            onClick={() => updateUrl(value, true)}
          >
            {SEARCHABLE_LIST_LABELS[list]}
          </ScopeChip>
        </div>
      )}
    </div>
  );
}

function ScopeChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
