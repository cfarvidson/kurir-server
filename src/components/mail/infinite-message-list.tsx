"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { MessageRow, type MessageItem } from "@/components/mail/message-list";
import { Loader2 } from "lucide-react";

interface PageData {
  messages: MessageItem[];
  nextCursor: string | null;
}

interface InfiniteMessageListProps {
  initialMessages: MessageItem[];
  initialCursor: string | null;
  category: "imbox" | "feed" | "paper-trail";
  basePath: string;
  showSections?: boolean;
  showArchiveAction?: boolean;
}

export function InfiniteMessageList({
  initialMessages,
  initialCursor,
  category,
  basePath,
  showSections = false,
  showArchiveAction = false,
}: InfiniteMessageListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

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

  if (showSections) {
    const newMessages = threads.filter((m) => !m.isRead);
    const seenMessages = threads.filter((m) => m.isRead);

    return (
      <div className="divide-y">
        {newMessages.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h2 className="px-4 py-3 text-sm font-medium text-muted-foreground md:px-6">
                New For You
              </h2>
            </div>
            <div>
              {newMessages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  basePath={basePath}
                  showArchiveAction={showArchiveAction}
                  onArchived={handleArchived}
                />
              ))}
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
              {seenMessages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  basePath={basePath}
                  showArchiveAction={showArchiveAction}
                  onArchived={handleArchived}
                />
              ))}
            </div>
          </section>
        )}

        <ScrollSentinel
          ref={sentinelRef}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
        />
      </div>
    );
  }

  return (
    <div>
      {threads.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          basePath={basePath}
          showArchiveAction={showArchiveAction}
          onArchived={handleArchived}
        />
      ))}
      <ScrollSentinel
        ref={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
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
        <p className="text-sm text-muted-foreground">You're all caught up</p>
      ) : null}
    </div>
  );
});
