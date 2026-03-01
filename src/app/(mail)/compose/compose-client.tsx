"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FromPicker, type FromConnection } from "@/components/mail/from-picker";
import { Send, X, Loader2, BookUser } from "lucide-react";

interface ContactSuggestion {
  id: string;
  email: string;
  displayName: string | null;
}

function useContactSearch(query: string) {
  const [results, setResults] = useState<ContactSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (query.trim().length < 1) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // aborted or failed
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { results, loading };
}

interface ComposeClientPageProps {
  /** All email connections for the current user */
  connections: FromConnection[];
  /** The connection ID to pre-select (e.g. from reply context) */
  defaultConnectionId?: string;
}

export function ComposeClientPage({
  connections,
  defaultConnectionId,
}: ComposeClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromConnectionId, setFromConnectionId] = useState(
    defaultConnectionId ??
      connections.find((c) => c.isDefault)?.id ??
      connections[0]?.id ??
      ""
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isTyping, setIsTyping] = useState(false);
  const searchQuery = isTyping ? to : "";
  const { results, loading } = useContactSearch(searchQuery);

  const selectContact = useCallback((contact: ContactSuggestion) => {
    setTo(contact.email);
    setShowSuggestions(false);
    setIsTyping(false);
    setSelectedIndex(-1);
  }, []);

  const handleToChange = (value: string) => {
    setTo(value);
    setIsTyping(true);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      selectContact(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSend = async () => {
    if (!to.trim()) {
      setError("Please enter a recipient");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          text: body,
          fromConnectionId: connections.length > 1 ? fromConnectionId : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send email");
      }

      router.push("/sent");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  };

  const hasSuggestions = showSuggestions && isTyping && (results.length > 0 || loading);
  const hasMultipleConnections = connections.length > 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">New Message</h1>
        <div className="flex items-center gap-1 md:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* From picker — only shown when user has multiple connections */}
          {hasMultipleConnections && (
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <FromPicker
                connections={connections}
                value={fromConnectionId}
                onChange={setFromConnectionId}
                className="w-full"
              />
            </div>
          )}

          {/* To field */}
          <div className="space-y-2">
            <Label htmlFor="to">To</Label>
            <div className="relative">
              <Input
                ref={inputRef}
                id="to"
                type="email"
                placeholder="Start typing a name or email..."
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                onFocus={() => {
                  if (isTyping && to.trim()) setShowSuggestions(true);
                }}
                onKeyDown={handleToKeyDown}
                autoComplete="off"
              />

              {/* Contact suggestions dropdown */}
              {hasSuggestions && (
                <div
                  ref={suggestionsRef}
                  className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg"
                >
                  {loading && results.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Searching contacts...
                    </div>
                  ) : (
                    results.map((contact, i) => (
                      <button
                        key={contact.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectContact(contact);
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          i === selectedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {(contact.displayName || contact.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          {contact.displayName ? (
                            <>
                              <div className="truncate font-medium">
                                {contact.displayName}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {contact.email}
                              </div>
                            </>
                          ) : (
                            <div className="truncate">{contact.email}</div>
                          )}
                        </div>
                        <BookUser className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="What's this about?"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <textarea
              id="body"
              spellCheck={false}
              className="flex min-h-[300px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
