"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Search,
  ChevronRight,
  Inbox,
  Newspaper,
  Receipt,
  X,
  Plus,
  CircleDashed,
  BookUser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddContactDialog } from "@/components/contacts/add-contact-dialog";

interface ContactEmail {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  sender: { category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null } | null;
}

interface Contact {
  id: string;
  name: string;
  emails: ContactEmail[];
}

interface ContactListProps {
  contacts: Contact[];
}

const categoryConfig = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary" },
  FEED: {
    label: "Feed",
    icon: Newspaper,
    color: "text-blue-600 dark:text-blue-400",
  },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color: "text-amber-600 dark:text-amber-400",
  },
} as const;

type FilterCategory =
  | "ALL"
  | "IMBOX"
  | "FEED"
  | "PAPER_TRAIL"
  | "UNCATEGORIZED";

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

/** Derive the "primary" category for display from a contact's emails. */
function getPrimaryCategory(
  contact: Contact,
): "IMBOX" | "FEED" | "PAPER_TRAIL" | null {
  const primary = contact.emails.find((e) => e.isPrimary);
  if (primary?.sender?.category) return primary.sender.category;
  // Fall back to the first email that has a sender category
  for (const e of contact.emails) {
    if (e.sender?.category) return e.sender.category;
  }
  return null;
}

/** Check if any email on the contact matches a given category. */
function contactMatchesCategory(
  contact: Contact,
  category: FilterCategory,
): boolean {
  if (category === "ALL") return true;
  if (category === "UNCATEGORIZED") {
    return contact.emails.every((e) => !e.sender?.category);
  }
  return contact.emails.some((e) => e.sender?.category === category);
}

function ContactCard({ contact }: { contact: Contact }) {
  const primaryEmail = contact.emails.find((e) => e.isPrimary);
  const emailDisplay = primaryEmail?.email ?? contact.emails[0]?.email ?? "";
  const extraCount = contact.emails.length - 1;
  const category = getPrimaryCategory(contact);
  const cat = category ? categoryConfig[category] : null;
  const CatIcon = cat?.icon;

  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="group flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-150 hover:bg-muted/60"
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-transform duration-150 group-hover:scale-105",
          getInitialColor(contact.name),
        )}
      >
        {contact.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{contact.name}</span>
          {CatIcon && (
            <CatIcon className={cn("h-3.5 w-3.5 shrink-0", cat!.color)} />
          )}
        </div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">{emailDisplay}</span>
          {extraCount > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none">
              +{extraCount}
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex shrink-0 items-center">
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </div>
    </Link>
  );
}

export function ContactList({ contacts }: ContactListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterCategory>("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    let result = contacts;

    if (filter !== "ALL") {
      result = result.filter((c) => contactMatchesCategory(c, filter));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.emails.some((e) => e.email.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [contacts, search, filter]);

  // Group by first letter of name
  const grouped = useMemo(() => {
    const groups = new Map<string, Contact[]>();

    for (const contact of filtered) {
      const letter = contact.name.charAt(0).toUpperCase();
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
    { key: "UNCATEGORIZED", label: "Uncategorized" },
  ];

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur-sm supports-backdrop-filter:bg-background/60 md:px-6">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="h-9 w-full rounded-lg border bg-muted/30 pl-9 pr-8 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/20"
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

          {/* Add button */}
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
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
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
              {contacts.length === 0 && !search && filter === "ALL" ? (
                <>
                  <div className="rounded-full bg-muted p-4">
                    <BookUser className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-medium">No contacts yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add one or approve senders in the Screener.
                  </p>
                </>
              ) : (
                <>
                  <div className="rounded-full bg-muted p-4">
                    {filter === "UNCATEGORIZED" ? (
                      <CircleDashed className="h-6 w-6 text-muted-foreground" />
                    ) : (
                      <Search className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {search
                      ? "No contacts match your search"
                      : "No contacts in this category"}
                  </p>
                </>
              )}
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
                <div className="sticky top-[105px] z-5 px-4 py-1.5">
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

      {/* Add Contact Dialog */}
      <AddContactDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
