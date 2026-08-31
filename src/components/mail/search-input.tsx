"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SEARCH_MIN_LENGTH,
  SEARCHABLE_LIST_LABELS,
  searchQueryHref,
  type SearchCategory,
} from "@/lib/mail/list-contract";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function SearchInput({ list }: { list?: SearchCategory }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const thisList = searchParams.get("scope") === "list";

  useEffect(() => {
    if (!isTypingRef.current) {
      setValue(searchParams.get("q") ?? "");
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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

  const replaceWith = useCallback(
    (patch: Record<string, string | null>) => {
      isTypingRef.current = false;
      router.replace(searchQueryHref(pathname, searchParams, patch));
    },
    [router, pathname, searchParams],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    isTypingRef.current = true;

    if (timerRef.current) clearTimeout(timerRef.current);
    // People answer from the first character (kurir-ios#117).
    timerRef.current = setTimeout(
      () =>
        replaceWith({
          q: newValue.trim().length >= SEARCH_MIN_LENGTH ? newValue : null,
        }),
      500,
    );
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
        <div className="flex max-w-md flex-wrap justify-end gap-1.5">
          <ScopeChip
            selected={!thisList}
            onClick={() => replaceWith({ scope: null })}
          >
            All mail
          </ScopeChip>
          <ScopeChip
            selected={thisList}
            onClick={() => replaceWith({ scope: "list" })}
          >
            {SEARCHABLE_LIST_LABELS[list]}
          </ScopeChip>
          <SearchFilterChips
            searchParams={searchParams}
            onPatch={replaceWith}
          />
        </div>
      )}
    </div>
  );
}

function SearchFilterChips({
  searchParams,
  onPatch,
}: {
  searchParams: URLSearchParams;
  onPatch: (patch: Record<string, string | null>) => void;
}) {
  const from = searchParams.get("from");
  const domain = searchParams.get("domain");
  const hasAttachment = searchParams.get("hasAttachment") === "true";
  const after = searchParams.get("after");
  const before = searchParams.get("before");
  const listChip = searchParams.get("list");

  return (
    <>
      <TextFilterChip
        idle="From"
        value={from}
        placeholder="sender@example.com"
        onApply={(next) => onPatch({ from: next })}
        onClear={() => onPatch({ from: null })}
      />
      <TextFilterChip
        idle="Domain"
        value={domain}
        placeholder="example.com"
        onApply={(next) => onPatch({ domain: next })}
        onClear={() => onPatch({ domain: null })}
      />
      <ScopeChip
        selected={hasAttachment}
        onClick={() =>
          onPatch({ hasAttachment: hasAttachment ? null : "true" })
        }
      >
        Has attachment
      </ScopeChip>
      <DateFilterChip
        after={after}
        before={before}
        onPatch={onPatch}
      />
      <ListFilterChip value={listChip} onPatch={onPatch} />
    </>
  );
}

function TextFilterChip({
  idle,
  value,
  placeholder,
  onApply,
  onClear,
}: {
  idle: string;
  value: string | null;
  placeholder: string;
  onApply: (value: string | null) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setDraft(value ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={Boolean(value)}
          className={chipClass(Boolean(value))}
        >
          {value ?? idle}
          {value ? (
            <span
              role="button"
              aria-label={`Clear ${idle}`}
              className="ml-1"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
            >
              ×
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2">
        <input
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApply(draft.trim() || null);
          }}
          className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm"
        />
        <button
          type="button"
          className="text-sm font-medium text-foreground"
          onClick={() => onApply(draft.trim() || null)}
        >
          Apply
        </button>
      </PopoverContent>
    </Popover>
  );
}

function DateFilterChip({
  after,
  before,
  onPatch,
}: {
  after: string | null;
  before: string | null;
  onPatch: (patch: Record<string, string | null>) => void;
}) {
  const selected = Boolean(after || before);
  const title = dateChipTitle(after, before);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={selected}
          className={chipClass(selected)}
        >
          {title}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 space-y-1">
        <button
          type="button"
          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          onClick={() =>
            onPatch({ after: daysAgoISO(7), before: null })
          }
        >
          Last 7 days
        </button>
        <button
          type="button"
          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          onClick={() =>
            onPatch({ after: daysAgoISO(30), before: null })
          }
        >
          Last 30 days
        </button>
        <button
          type="button"
          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          onClick={() => onPatch({ after: thisYearISO(), before: null })}
        >
          This year
        </button>
        {selected && (
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => onPatch({ after: null, before: null })}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ListFilterChip({
  value,
  onPatch,
}: {
  value: string | null;
  onPatch: (patch: Record<string, string | null>) => void;
}) {
  const selected = Boolean(value);
  const title = value && value in SEARCHABLE_LIST_LABELS
    ? SEARCHABLE_LIST_LABELS[value as SearchCategory]
    : "List";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={selected}
          className={chipClass(selected)}
        >
          {title}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 space-y-1">
        {(Object.keys(SEARCHABLE_LIST_LABELS) as SearchCategory[]).map(
          (id) => (
            <button
              key={id}
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => onPatch({ list: id, scope: null })}
            >
              {SEARCHABLE_LIST_LABELS[id]}
            </button>
          ),
        )}
        {selected && (
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => onPatch({ list: null })}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
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
      className={chipClass(selected)}
    >
      {children}
    </button>
  );
}

function chipClass(selected: boolean) {
  return cn(
    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
    selected
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}

function daysAgoISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function thisYearISO(): string {
  return new Date(new Date().getFullYear(), 0, 1).toISOString();
}

function dateChipTitle(after: string | null, before: string | null): string {
  if (!after && !before) return "Date";
  if (after && before) {
    return `${after.slice(0, 10)} - ${before.slice(0, 10)}`;
  }
  if (after) return `After ${after.slice(0, 10)}`;
  return "Date";
}
