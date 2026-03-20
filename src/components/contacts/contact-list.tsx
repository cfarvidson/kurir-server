"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Search,
  Mail,
  ChevronRight,
  Inbox,
  Newspaper,
  Receipt,
  X,
} from "lucide-react";

interface Contact {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
  messageCount: number;
  decidedAt: Date | null;
}

interface ContactListProps {
  contacts: Contact[];
}

const categoryConfig = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: { label: "Feed", icon: Newspaper, color: "text-blue-600 dark:text-blue-400" },
  PAPER_TRAIL: { label: "Paper Trail", icon: Receipt, color: "text-amber-600 dark:text-amber-400" },
} as const;

type FilterCategory = "ALL" | "IMBOX" | "FEED" | "PAPER_TRAIL";

function getInitialColor(str: string): string {
  const palettes = [
    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
    "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palettes[Math.abs(hash) % palettes.length];
}

function ContactCard({ contact }: { contact: Contact }) {
  const name = contact.displayName || contact.email.split("@")[0];
  const cat = categoryConfig[contact.category ?? "IMBOX"];
  const CatIcon = cat.icon;

  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="group flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-150 hover:bg-muted/60"
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-transform duration-150 group-hover:scale-105",
          getInitialColor(contact.email)
        )}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <CatIcon className={cn("h-3.5 w-3.5 shrink-0", cat.color)} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {contact.email}
        </div>
      </div>

      {/* Stats + Arrow */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" />
          <span className="tabular-nums">{contact.messageCount}</span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </div>
    </Link>
  );
}

export function ContactList({ contacts }: ContactListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterCategory>("ALL");

  const filtered = useMemo(() => {
    let result = contacts;

    if (filter !== "ALL") {
      result = result.filter((c) => c.category === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.displayName?.toLowerCase().includes(q) ||
          c.domain.toLowerCase().includes(q)
      );
    }

    return result;
  }, [contacts, search, filter]);

  // Group by first letter of display name or email
  const grouped = useMemo(() => {
    const groups = new Map<string, Contact[]>();

    for (const contact of filtered) {
      const name = contact.displayName || contact.email;
      const letter = name.charAt(0).toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : "#";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(contact);
    }

    // Sort groups alphabetically, # last
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const filterOptions: { key: FilterCategory; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "IMBOX", label: "Imbox" },
    { key: "FEED", label: "Feed" },
    { key: "PAPER_TRAIL", label: "Paper Trail" },
  ];

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
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

        {/* Filter tabs */}
        <div className="mt-2.5 flex gap-1">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === opt.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contact groups */}
      <div className="px-2 py-2">
        <AnimatePresence mode="popLayout">
          {grouped.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center px-6 py-16 text-center"
            >
              <div className="rounded-full bg-muted p-4">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {search
                  ? "No contacts match your search"
                  : "No contacts in this category"}
              </p>
            </motion.div>
          ) : (
            grouped.map(([letter, groupContacts]) => (
              <motion.div
                key={letter}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                {/* Letter header */}
                <div className="sticky top-[105px] z-[5] px-4 py-1.5">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground/70">
                    {letter}
                  </span>
                </div>

                {/* Contacts in group */}
                {groupContacts.map((contact) => (
                  <ContactCard key={contact.id} contact={contact} />
                ))}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Footer count */}
      {filtered.length > 0 && (
        <div className="border-t px-6 py-3 text-center text-xs text-muted-foreground/60">
          {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
