"use client";

import { useState, useMemo } from "react";
import { Search, X, Check } from "lucide-react";
import type { SenderStatus, SenderCategory } from "@prisma/client";
import { ScreenerView } from "@/components/screener/screener-view";
import { ScreenerHintBanner } from "@/components/screener/screener-hint-banner";
import { SkippedSenderList } from "@/components/screener/skipped-sender-list";
import { ScreenedSenderList } from "@/components/screener/screened-sender-list";
import { PendingSenderList } from "@/components/screener/pending-sender-list";

interface PendingSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  messages: {
    id: string;
    subject: string | null;
    snippet: string | null;
    receivedAt: Date;
  }[];
  _count: { messages: number };
}

interface SkippedSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  skippedUntil: Date | null;
  _count: { messages: number };
}

interface ScreenedSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  status: SenderStatus;
  category: SenderCategory | null;
  decidedAt: Date | null;
  _count: { messages: number };
}

interface ScreenerContentProps {
  pendingSenders: PendingSender[];
  skippedSenders: SkippedSender[];
  screenedSenders: ScreenedSender[];
}

function matchesSearch(
  sender: { email: string; displayName: string | null; domain: string },
  query: string,
): boolean {
  return (
    sender.email.toLowerCase().includes(query) ||
    (sender.displayName?.toLowerCase().includes(query) ?? false) ||
    sender.domain.toLowerCase().includes(query)
  );
}

export function ScreenerContent({
  pendingSenders,
  skippedSenders,
  screenedSenders,
}: ScreenerContentProps) {
  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;
  const query = search.toLowerCase();

  const filteredPending = useMemo(
    () =>
      isSearching
        ? pendingSenders.filter((s) => matchesSearch(s, query))
        : pendingSenders,
    [pendingSenders, isSearching, query],
  );

  const filteredSkipped = useMemo(
    () =>
      isSearching
        ? skippedSenders.filter((s) => matchesSearch(s, query))
        : skippedSenders,
    [skippedSenders, isSearching, query],
  );

  const filteredScreened = useMemo(
    () =>
      isSearching
        ? screenedSenders.filter((s) => matchesSearch(s, query))
        : screenedSenders,
    [screenedSenders, isSearching, query],
  );

  const totalResults =
    filteredPending.length + filteredSkipped.length + filteredScreened.length;

  return (
    <>
      {/* Search bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search senders..."
            className="h-9 w-full rounded-lg border bg-muted/30 pl-9 pr-8 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {totalResults === 0 && !isSearching ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="rounded-full bg-green-100 p-4">
            <Check className="h-8 w-8 text-green-600" strokeWidth={1.5} />
          </div>
          <h2 className="mt-4 text-lg font-medium">No senders yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sync your email to start screening senders.
          </p>
        </div>
      ) : isSearching && totalResults === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="rounded-full bg-muted p-4">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            No senders match &ldquo;{search.trim()}&rdquo;
          </p>
        </div>
      ) : (
        <>
          {/* Pending: card view normally, list view when searching */}
          {filteredPending.length > 0 &&
            (isSearching ? (
              <PendingSenderList senders={filteredPending} />
            ) : (
              <>
                <ScreenerHintBanner />
                <ScreenerView senders={filteredPending} />
              </>
            ))}

          {filteredSkipped.length > 0 && (
            <SkippedSenderList senders={filteredSkipped} />
          )}

          {filteredScreened.length > 0 && (
            <ScreenedSenderList senders={filteredScreened} />
          )}
        </>
      )}
    </>
  );
}
