"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { MessageRow, type MessageItem } from "@/components/mail/message-list";
import { SelectionActionBar } from "@/components/mail/selection-action-bar";
import { Loader2, CheckSquare } from "lucide-react";

interface PageData {
  messages: MessageItem[];
  nextCursor: string | null;
}

interface InfiniteMessageListProps {
  initialMessages: MessageItem[];
  initialCursor: string | null;
  category: "imbox" | "feed" | "paper-trail" | "archive";
  basePath: string;
  showSections?: boolean;
  showArchiveAction?: boolean;
  showSelectionToggle?: boolean;
}

export function InfiniteMessageList({
  initialMessages,
  initialCursor,
  category,
  basePath,
  showSections = false,
  showArchiveAction = false,
  showSelectionToggle = false,
}: InfiniteMessageListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionModeActive, setSelectionModeActive] = useState(false);
  const isSelectionMode = selectionModeActive || selectedIds.size > 0;

  const toggleSelection = useCallback((threadKey: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadKey)) {
        next.delete(threadKey);
      } else {
        next.add(threadKey);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionModeActive(false);
  }, []);

  // Escape key clears selection
  useEffect(() => {
    if (!isSelectionMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSelectionMode, clearSelection]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<PageData>({
      queryKey: ["messages", category],
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams({ category });
        if (pageParam) params.set("cursor", pageParam as string);
        const res = await fetch(`/api/messages?${params}`);
        if (!res.ok) throw new Error("Failed to fetch messages");
        return res.json();
      },
      initialPageParam: null as string | null,
      initialData: {
        pages: [{ messages: initialMessages, nextCursor: initialCursor }],
        pageParams: [null],
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30_000,
      gcTime: 300_000,
    });

  // IntersectionObserver to trigger loading more
  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) fetchNextPage();
      },
      { rootMargin: "0px 0px 200px 0px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  // Incremental thread collapsing across all pages
  const threads = useMemo(() => {
    if (!data) return [];

    const threadMap = new Map<string, MessageItem>();
    const hasUnread = new Set<string>();

    for (const page of data.pages) {
      for (const msg of page.messages) {
        const key = msg.threadId || msg.id;
        if (!msg.isRead) hasUnread.add(key);
        // First occurrence = latest (pages are ordered by receivedAt desc)
        if (!threadMap.has(key)) {
          threadMap.set(key, msg);
        }
      }
    }

    // Propagate unread status
    return Array.from(threadMap.values()).map((msg) => {
      const key = msg.threadId || msg.id;
      if (hasUnread.has(key) && msg.isRead) {
        return { ...msg, isRead: false };
      }
      return msg;
    });
  }, [data]);

  const handleArchived = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["messages", category] });
  }, [queryClient, category]);

  // Resolve selected threadKeys to representative message IDs for the server action
  const selectedMessageIds = useMemo(() => {
    return threads
      .filter((msg) => selectedIds.has(msg.threadId || msg.id))
      .map((msg) => msg.id);
  }, [threads, selectedIds]);

  const renderRow = (message: MessageItem) => {
    const threadKey = message.threadId || message.id;
    return (
      <MessageRow
        key={message.id}
        message={message}
        basePath={basePath}
        showArchiveAction={showArchiveAction}
        onArchived={handleArchived}
        isSelectionMode={isSelectionMode}
        isSelected={selectedIds.has(threadKey)}
        onToggleSelect={() => toggleSelection(threadKey)}
      />
    );
  };

  const selectionToggle = showSelectionToggle && (
    <div className="flex items-center justify-end px-4 py-2 md:px-6">
      <button
        onClick={() =>
          isSelectionMode
            ? clearSelection()
            : setSelectionModeActive(true)
        }
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors ${
          isSelectionMode
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <CheckSquare className="h-3.5 w-3.5" />
        {isSelectionMode ? "Cancel" : "Select"}
      </button>
    </div>
  );

  if (showSections) {
    const newMessages = threads.filter((m) => !m.isRead);
    const seenMessages = threads.filter((m) => m.isRead);

    return (
      <div className="divide-y">
        {selectionToggle}

        {newMessages.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                New For You
              </h2>
            </div>
            <div>
              {newMessages.map(renderRow)}
            </div>
          </section>
        )}

        {seenMessages.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                Previously Seen
              </h2>
            </div>
            <div>
              {seenMessages.map(renderRow)}
            </div>
          </section>
        )}

        <ScrollSentinel
          ref={sentinelRef}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
        />

        <SelectionActionBar
          selectedMessageIds={selectedMessageIds}
          onComplete={clearSelection}
          onQueryInvalidate={handleArchived}
        />
      </div>
    );
  }

  return (
    <div>
      {selectionToggle}
      {threads.map(renderRow)}
      <ScrollSentinel
        ref={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
      />
      <SelectionActionBar
        selectedMessageIds={selectedMessageIds}
        onComplete={clearSelection}
        onQueryInvalidate={handleArchived}
      />
    </div>
  );
}

import { forwardRef } from "react";

const ScrollSentinel = forwardRef<
  HTMLDivElement,
  { isFetchingNextPage: boolean; hasNextPage: boolean | undefined }
>(function ScrollSentinel({ isFetchingNextPage, hasNextPage }, ref) {
  return (
    <div ref={ref} className="py-6 text-center">
      {isFetchingNextPage ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      ) : hasNextPage === false ? (
        <p className="text-sm text-muted-foreground">You&apos;re all caught up</p>
      ) : null}
    </div>
  );
});
