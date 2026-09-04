"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  approveSender,
  rejectSender,
  changeSenderCategory,
} from "@/actions/senders";
import {
  changeDomainRuleCategory,
  deleteDomainRule,
} from "@/actions/domain-rules";
import {
  changeSubjectRuleCategory,
  deleteSubjectRule,
} from "@/actions/subject-rules";
import { ScreenDomainMenu } from "@/components/screener/screen-domain-menu";
import {
  X,
  Loader2,
  Check,
  Inbox,
  Newspaper,
  Receipt,
  Globe,
  TextQuote,
} from "lucide-react";

import type { SenderStatus, SenderCategory } from "@prisma/client";

interface ScreenedSender {
  id: string;
  email: string;
  displayName: string | null;
  domain: string;
  status: SenderStatus;
  category: SenderCategory | null;
  decidedAt: Date | null;
  messageCount: number;
}

interface DomainRule {
  id: string;
  pattern: string;
  includeSubdomains: boolean;
  status: SenderStatus;
  category: SenderCategory | null;
}

/** Display form of a rule: `*.github.com` for wildcard, bare domain otherwise. */
function ruleLabel(rule: DomainRule): string {
  return rule.includeSubdomains ? `*.${rule.pattern}` : rule.pattern;
}

interface SubjectRule {
  id: string;
  scope: "ADDRESS" | "DOMAIN" | "SUBDOMAINS";
  scopeValue: string;
  pattern: string;
  status: SenderStatus;
  category: SenderCategory | null;
}

/** Display form of a subject-rule scope: address, domain or `*.domain`. */
function subjectRuleScopeLabel(rule: SubjectRule): string {
  return rule.scope === "SUBDOMAINS" ? `*.${rule.scopeValue}` : rule.scopeValue;
}

const CATEGORY_CONFIG = {
  IMBOX: { label: "Imbox", Icon: Inbox, color: "text-imbox" },
  FEED: { label: "The Feed", Icon: Newspaper, color: "text-feed" },
  PAPER_TRAIL: { label: "Paper Trail", Icon: Receipt, color: "text-paper-trail" },
} as const;

export function ScreenedSenderList({
  senders,
  screenedIsCapped = false,
  domainRules = [],
  subjectRules = [],
}: {
  senders: ScreenedSender[];
  screenedIsCapped?: boolean;
  domainRules?: DomainRule[];
  subjectRules?: SubjectRule[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleChangeCategory = (senderId: string, category: SenderCategory) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await changeSenderCategory(senderId, category);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleReject = (senderId: string) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await rejectSender(senderId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleApprove = (
    senderId: string,
    category: SenderCategory = "IMBOX",
  ) => {
    setProcessingId(senderId);
    startTransition(async () => {
      await approveSender(senderId, category);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleChangeRuleCategory = (
    ruleId: string,
    category: SenderCategory,
  ) => {
    setProcessingId(ruleId);
    startTransition(async () => {
      await changeDomainRuleCategory(ruleId, category);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleDeleteRule = (ruleId: string) => {
    setProcessingId(ruleId);
    startTransition(async () => {
      await deleteDomainRule(ruleId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleChangeSubjectRuleCategory = (
    ruleId: string,
    category: SenderCategory,
  ) => {
    setProcessingId(ruleId);
    startTransition(async () => {
      await changeSubjectRuleCategory(ruleId, category);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const handleDeleteSubjectRule = (ruleId: string) => {
    setProcessingId(ruleId);
    startTransition(async () => {
      await deleteSubjectRule(ruleId);
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setProcessingId(null);
      router.refresh();
    });
  };

  const approved = senders.filter((s) => s.status === "APPROVED");
  const rejected = senders.filter((s) => s.status === "REJECTED");

  return (
    <div className="border-t border-border">
      <div className="px-4 py-4 md:px-6">
        <h2 className="eyebrow text-muted-foreground">Previously Screened</h2>
        {screenedIsCapped && (
          <p className="mt-1 text-sm text-muted-foreground">
            Showing the 200 most recently decided senders.
          </p>
        )}
      </div>

      {domainRules.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Domain rules{" "}
              <span className="tabular-nums">({domainRules.length})</span>
            </span>
          </div>
          {domainRules.map((rule) => {
            const isProcessing = processingId === rule.id;

            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-6"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Globe
                    className="size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {ruleLabel(rule)}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {rule.status === "REJECTED"
                        ? "Screened out"
                        : `Everyone at ${ruleLabel(rule)}`}
                    </div>
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const isActive =
                        rule.status === "APPROVED" && rule.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() =>
                            handleChangeRuleCategory(rule.id, cat)
                          }
                          disabled={isPending}
                          title={c.label}
                          aria-pressed={isActive}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/50 hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <c.Icon
                            className={cn("size-4 shrink-0", c.color)}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                          {isActive && (
                            <Check
                              className="h-3 w-3 text-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={isPending}
                      title="Remove rule"
                      className="ml-1 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {subjectRules.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Subject rules{" "}
              <span className="tabular-nums">({subjectRules.length})</span>
            </span>
          </div>
          {subjectRules.map((rule) => {
            const isProcessing = processingId === rule.id;

            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-6"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <TextQuote
                    className="size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      &ldquo;{rule.pattern}&rdquo;
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {rule.status === "REJECTED"
                        ? `Screened out from ${subjectRuleScopeLabel(rule)}`
                        : `From ${subjectRuleScopeLabel(rule)}`}
                    </div>
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const isActive =
                        rule.status === "APPROVED" && rule.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() =>
                            handleChangeSubjectRuleCategory(rule.id, cat)
                          }
                          disabled={isPending}
                          title={c.label}
                          aria-pressed={isActive}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/50 hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <c.Icon
                            className={cn("size-4 shrink-0", c.color)}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                          {isActive && (
                            <Check
                              className="h-3 w-3 text-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleDeleteSubjectRule(rule.id)}
                      disabled={isPending}
                      title="Remove rule"
                      className="ml-1 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Approved{" "}
              <span className="tabular-nums">({approved.length})</span>
            </span>
          </div>
          {approved.map((sender) => {
            const isProcessing = processingId === sender.id;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {sender.email} &middot;{" "}
                    <span className="tabular-nums">
                      {sender.messageCount}
                    </span>{" "}
                    email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <ScreenDomainMenu
                      senderId={sender.id}
                      domain={sender.domain}
                    />
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      const isActive = sender.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => handleChangeCategory(sender.id, cat)}
                          disabled={isPending}
                          title={c.label}
                          aria-pressed={isActive}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/50 hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <c.Icon
                            className={cn("size-4 shrink-0", c.color)}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                          {isActive && (
                            <Check
                              className="h-3 w-3 text-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleReject(sender.id)}
                      disabled={isPending}
                      title="Reject"
                      className="ml-1 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <div className="px-4 py-2 md:px-6">
            <span className="eyebrow text-muted-foreground/70">
              Rejected{" "}
              <span className="tabular-nums">({rejected.length})</span>
            </span>
          </div>
          {rejected.map((sender) => {
            const isProcessing = processingId === sender.id;

            return (
              <div
                key={sender.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 opacity-60 md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {sender.displayName || sender.email}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {sender.email} &middot;{" "}
                    <span className="tabular-nums">
                      {sender.messageCount}
                    </span>{" "}
                    email(s)
                  </div>
                </div>

                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <ScreenDomainMenu
                      senderId={sender.id}
                      domain={sender.domain}
                    />
                    {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
                      const c = CATEGORY_CONFIG[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => handleApprove(sender.id, cat)}
                          disabled={isPending}
                          title={`Approve to ${c.label}`}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                          <c.Icon
                            className={cn("size-4 shrink-0", c.color)}
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
