"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mail,
  PenSquare,
  Inbox,
  Newspaper,
  Receipt,
  Star,
  Split,
  X,
  Plus,
  Check,
  Link2,
  Trash2,
  Pencil,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactThreadList } from "@/components/contacts/contact-thread-list";
import {
  updateContactName,
  deleteContact,
  addContactEmail,
  removeContactEmail,
  setContactEmailPrimary,
  linkContacts,
  unlinkContactEmail,
} from "@/actions/contacts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContactEmail {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  sender: { category: string | null; messageCount: number } | null;
}

interface ContactData {
  id: string;
  name: string;
  emails: ContactEmail[];
}

interface Conversation {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  threadCount: number;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  sender?: {
    displayName: string | null;
    email: string;
  } | null;
}

interface ContactDetailProps {
  contact: ContactData;
  conversations: Conversation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const categoryConfig: Record<
  string,
  { label: string; icon: typeof Inbox; color: string }
> = {
  IMBOX: { label: "Imbox", icon: Inbox, color: "text-primary bg-primary/10" },
  FEED: {
    label: "Feed",
    icon: Newspaper,
    color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
  },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color:
      "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30",
  },
};

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContactDetail({ contact, conversations }: ContactDetailProps) {
  const router = useRouter();

  // --- Editable name ---
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(contact.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // --- Add email form ---
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const addEmailInputRef = useRef<HTMLInputElement>(null);

  // --- Delete confirm ---
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- Link dialog ---
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const linkSearchRef = useRef<HTMLInputElement>(null);

  // --- Remove email confirm ---
  const [removeEmailId, setRemoveEmailId] = useState<string | null>(null);

  // Derived
  const primaryEmail =
    contact.emails.find((e) => e.isPrimary)?.email ??
    contact.emails[0]?.email ??
    "";
  const displayName = contact.name || primaryEmail.split("@")[0];

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  useEffect(() => {
    if (showAddEmail) {
      // Small delay for the DOM to render
      setTimeout(() => addEmailInputRef.current?.focus(), 50);
    }
  }, [showAddEmail]);

  // --- Name editing ---
  const saveName = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === contact.name) {
      setNameValue(contact.name);
      setIsEditingName(false);
      return;
    }
    try {
      await updateContactName(contact.id, trimmed);
      setIsEditingName(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update name");
      setNameValue(contact.name);
      setIsEditingName(false);
    }
  }, [nameValue, contact.id, contact.name]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    } else if (e.key === "Escape") {
      setNameValue(contact.name);
      setIsEditingName(false);
    }
  };

  // --- Set primary ---
  const handleSetPrimary = async (emailEntry: ContactEmail) => {
    if (emailEntry.isPrimary) return;
    try {
      await setContactEmailPrimary(emailEntry.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set primary");
    }
  };

  // --- Unlink (split) ---
  const handleUnlink = async (emailEntry: ContactEmail) => {
    try {
      const newContactId = await unlinkContactEmail(emailEntry.id);
      toast("Email split into new contact", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await linkContacts(contact.id, newContactId);
              toast.success("Split undone");
            } catch {
              toast.error("Failed to undo split");
            }
          },
        },
        duration: 5000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to split email");
    }
  };

  // --- Remove email ---
  const handleRemoveEmail = async (emailId: string) => {
    setRemoveEmailId(null);
    try {
      await removeContactEmail(emailId);
      toast.success("Email removed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove email",
      );
    }
  };

  // --- Add email ---
  const handleAddEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;

    setIsAddingEmail(true);
    try {
      await addContactEmail(contact.id, trimmed, "personal");
      setNewEmail("");
      setShowAddEmail(false);
      toast.success("Email added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add email");
    } finally {
      setIsAddingEmail(false);
    }
  };

  // --- Delete contact ---
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteContact(contact.id);
      router.push("/contacts");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete contact",
      );
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  // --- Link search ---
  useEffect(() => {
    if (!showLinkDialog) {
      setLinkQuery("");
      setLinkResults([]);
      return;
    }
    setTimeout(() => linkSearchRef.current?.focus(), 50);
  }, [showLinkDialog]);

  useEffect(() => {
    if (!linkQuery.trim()) {
      setLinkResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(linkQuery.trim())}`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data: { id: string; name: string; email: string }[] =
            await res.json();
          // Exclude current contact and sender-prefixed results
          setLinkResults(
            data.filter(
              (c) => c.id !== contact.id && !c.id.startsWith("sender-"),
            ),
          );
        }
      } catch {
        // Aborted or network error - ignore
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [linkQuery, contact.id]);

  const handleLink = async (sourceId: string) => {
    setIsLinking(true);
    try {
      await linkContacts(contact.id, sourceId);
      setShowLinkDialog(false);
      toast.success("Contacts merged");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to merge contacts",
      );
    } finally {
      setIsLinking(false);
    }
  };

  // --- Aggregate stats ---
  const totalMessages = contact.emails.reduce(
    (sum, e) => sum + (e.sender?.messageCount ?? 0),
    0,
  );

  // Category badges from all linked senders
  const categories = [
    ...new Set(
      contact.emails
        .map((e) => e.sender?.category)
        .filter((c): c is string => c !== null && c !== undefined),
    ),
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-4 md:px-6">
        <Link
          href="/contacts"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Contacts
        </Link>
      </div>

      {/* Contact profile */}
      <div className="border-b px-4 py-5 md:px-6 md:py-6">
        <div className="flex items-start gap-4 md:gap-5">
          {/* Large avatar */}
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold md:h-16 md:w-16 md:text-xl ${getInitialColor(primaryEmail)}`}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            {/* Editable name */}
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={saveName}
                onKeyDown={handleNameKeyDown}
                className="w-full border-b border-primary bg-transparent text-lg font-semibold tracking-tight outline-none md:text-xl"
              />
            ) : (
              <button
                onClick={() => setIsEditingName(true)}
                className="group flex items-center gap-2 text-left"
              >
                <h1 className="text-lg font-semibold tracking-tight md:text-xl">
                  {displayName}
                </h1>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}

            {/* Email list */}
            <div className="mt-2 space-y-1.5">
              {contact.emails.map((emailEntry) => (
                <div
                  key={emailEntry.id}
                  className="group/email flex items-center gap-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {emailEntry.email}
                  </span>

                  {/* Action icons - visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/email:opacity-100">
                    {/* Primary star */}
                    <button
                      onClick={() => handleSetPrimary(emailEntry)}
                      className="rounded p-1 hover:bg-muted"
                      title={
                        emailEntry.isPrimary
                          ? "Primary email"
                          : "Set as primary"
                      }
                    >
                      <Star
                        className={`h-3.5 w-3.5 ${
                          emailEntry.isPrimary
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground"
                        }`}
                      />
                    </button>

                    {/* Split/unlink - only if 2+ emails */}
                    {contact.emails.length >= 2 && (
                      <button
                        onClick={() => handleUnlink(emailEntry)}
                        className="rounded p-1 hover:bg-muted"
                        title="Split into separate contact"
                      >
                        <Split className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}

                    {/* Remove - only if 2+ emails */}
                    {contact.emails.length >= 2 && (
                      <button
                        onClick={() => setRemoveEmailId(emailEntry.id)}
                        className="rounded p-1 hover:bg-destructive/10"
                        title="Remove email"
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>

                  {/* Primary indicator - always visible */}
                  {emailEntry.isPrimary && (
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 group-hover/email:hidden" />
                  )}
                </div>
              ))}

              {/* Add email row */}
              {showAddEmail ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={addEmailInputRef}
                    type="email"
                    placeholder="email@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddEmail();
                      } else if (e.key === "Escape") {
                        setShowAddEmail(false);
                        setNewEmail("");
                      }
                    }}
                    className="h-7 max-w-[240px] text-sm"
                    disabled={isAddingEmail}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={handleAddEmail}
                    disabled={isAddingEmail || !newEmail.trim()}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setShowAddEmail(false);
                      setNewEmail("");
                    }}
                    disabled={isAddingEmail}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddEmail(true)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add email
                </button>
              )}
            </div>

            {/* Stats row */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* Category badges */}
              {categories.map((cat) => {
                const config = categoryConfig[cat];
                if (!config) return null;
                const CatIcon = config.icon;
                return (
                  <span
                    key={cat}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.color}`}
                  >
                    <CatIcon className="h-3 w-3" />
                    {config.label}
                  </span>
                );
              })}

              {/* Message count */}
              {totalMessages > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  {totalMessages} message{totalMessages !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowLinkDialog(true)}
              title="Merge with another contact"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Link</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowDeleteDialog(true)}
              title="Delete contact"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </Button>

            <Button asChild size="sm" className="gap-1.5">
              <Link href={`/compose?to=${encodeURIComponent(primaryEmail)}`}>
                <PenSquare className="h-3.5 w-3.5" />
                Compose
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-medium">No conversations yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Messages with {displayName} will appear here.
            </p>
          </div>
        ) : (
          <ContactThreadList
            conversations={conversations}
            contactName={displayName}
          />
        )}
      </div>

      {/* --- Remove email confirmation dialog --- */}
      <Dialog
        open={removeEmailId !== null}
        onOpenChange={(open) => !open && setRemoveEmailId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove email</DialogTitle>
            <DialogDescription>
              This will remove the email address from this contact. The email
              will no longer be associated with {displayName}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveEmailId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeEmailId && handleRemoveEmail(removeEmailId)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Delete contact confirmation dialog --- */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete contact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {displayName}? This will remove
              the contact and all linked email addresses. Messages will not be
              affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Link/merge dialog --- */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge contacts</DialogTitle>
            <DialogDescription>
              Search for a contact to merge into {displayName}. All emails from
              the selected contact will be moved here.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={linkSearchRef}
              placeholder="Search contacts..."
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-[240px] overflow-auto">
            {isSearching && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isSearching && linkQuery.trim() && linkResults.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No contacts found
              </div>
            )}

            {!isSearching &&
              linkResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleLink(result.id)}
                  disabled={isLinking}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${getInitialColor(result.email)}`}
                  >
                    {(result.name || result.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {result.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {result.email}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
