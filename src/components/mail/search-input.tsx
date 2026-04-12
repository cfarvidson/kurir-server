"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export function SearchInput() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

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

  const updateUrl = useCallback(
    (query: string) => {
      isTypingRef.current = false;
      if (query.length >= 2) {
        router.replace(`${pathname}?q=${encodeURIComponent(query)}`);
      } else {
        router.replace(pathname);
      }
    },
    [router, pathname],
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

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search..."
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="h-9 w-40 rounded-md border border-input bg-transparent py-1 pl-8 pr-8 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:w-56"
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
  );
}
