"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { MessageRow, type MessageItem } from "@/components/mail/message-list";
import { SelectionActionBar } from "@/components/mail/selection-action-bar";
import { ListKeyboardHandler } from "@/components/mail/list-keyboard-handler";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";
import { Loader2, CheckSquare } from "lucide-react";

interface PageData {
  messages: MessageItem[];
  nextCursor: string | null;
}

interface InfiniteMessageListProps {
  initialMessages: MessageItem[];
  initialCursor: string | null;
  category: "imbox" | "feed" | "paper-trail" | "archive" | "snoozed" | "follow-up";
  basePath: string;
  showSections?: boolean;
  showArchiveAction?: boolean;
  showUnarchiveAction?: boolean;
  showSnoozeAction?: boolean;
  showSelectionToggle?: boolean;
  showSnoozedUntil?: boolean;
  showFollowUpAction?: boolean;
}

export function InfiniteMessageList({
  initialMessages,
  initialCursor,
  category,
  basePath,
  showSections = false,
  showArchiveAction = false,
  showUnarchiveAction = false,
  showSnoozeAction = false,
  showSelectionToggle = false,
  showSnoozedUntil = false,
  showFollowUpAction = false,
}: InfiniteMessageListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { focusedIndex, registerList } = useKeyboardNavigationStore();

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

  // Register thread list in navigation store for j/k in thread detail view
  useEffect(() => {
    const ids = threads.map((m) => m.id);
    registerList(ids, basePath);
  }, [threads, basePath, registerList]);

  const handleArchived = useCallback(
    (messageIds?: string | string[]) => {
      const ids = Array.isArray(messageIds)
        ? messageIds
        : messageIds
          ? [messageIds]
          : [];
      if (ids.length === 0) return;

      // Optimistically remove from cache — do NOT refetch yet
      const allMessages = data?.pages.flatMap((p) => p.messages) ?? [];
      const threadKeys = new Set(
        ids.map((id) => {
          const target = allMessages.find((m) => m.id === id);
          return target?.threadId || id;
        }),
      );

      queryClient.setQueryData<{ pages: PageData[]; pageParams: unknown[] }>(
        ["messages", category],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.filter(
                (m) => !threadKeys.has(m.threadId || m.id),
              ),
            })),
          };
        },
      );
    },
    [queryClient, category, data],
  );


  // Resolve selected threadKeys to representative message IDs for the server action
  const selectedMessageIds = useMemo(() => {
    return threads
      .filter((msg) => selectedIds.has(msg.threadId || msg.id))
      .map((msg) => msg.id);
  }, [threads, selectedIds]);

  const renderRow = (message: MessageItem) => {
    const threadKey = message.threadId || message.id;
    const globalIndex = threads.indexOf(message);
    return (
      <motion.div
        key={message.id}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <MessageRow
          message={message}
          basePath={basePath}
          showArchiveAction={showArchiveAction}
          showUnarchiveAction={showUnarchiveAction}
          showSnoozeAction={showSnoozeAction}
          showSnoozedUntil={showSnoozedUntil}
          showFollowUpAction={showFollowUpAction}
          onArchived={handleArchived}
          isSelectionMode={isSelectionMode}
          isSelected={selectedIds.has(threadKey)}
          onToggleSelect={() => toggleSelection(threadKey)}
          isFocused={globalIndex === focusedIndex}
        />
      </motion.div>
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

  const keyboardHandler = (
    <ListKeyboardHandler
      threads={threads}
      basePath={basePath}
      onArchived={handleArchived}
      onToggleSelect={toggleSelection}
      showSnoozeAction={showSnoozeAction}
      showFollowUpAction={showFollowUpAction}
    />
  );

  if (showSections) {
    const newMessages = threads.filter((m) => !m.isRead);
    const seenMessages = threads.filter((m) => m.isRead);

    return (
      <div className="divide-y">
        {keyboardHandler}
        {selectionToggle}

        {newMessages.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                New For You
              </h2>
            </div>
            <AnimatePresence mode="popLayout">
              {newMessages.map(renderRow)}
            </AnimatePresence>
          </section>
        )}

        {seenMessages.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                Previously Seen
              </h2>
            </div>
            <AnimatePresence mode="popLayout">
              {seenMessages.map(renderRow)}
            </AnimatePresence>
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
          showSnoozeAction={showSnoozeAction}
          showUnarchiveAction={showUnarchiveAction}
          sourcePath={basePath}
        />
      </div>
    );
  }

  return (
    <div>
      {keyboardHandler}
      {selectionToggle}
      <AnimatePresence mode="popLayout">
        {threads.map(renderRow)}
      </AnimatePresence>
      <ScrollSentinel
        ref={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
      />
      <SelectionActionBar
        selectedMessageIds={selectedMessageIds}
        onComplete={clearSelection}
        onQueryInvalidate={handleArchived}
        showSnoozeAction={showSnoozeAction}
        showUnarchiveAction={showUnarchiveAction}
        sourcePath={basePath}
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
