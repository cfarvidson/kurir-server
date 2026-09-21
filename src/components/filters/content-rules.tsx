"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";
import type { ContentRuleAction, SubjectRuleScope } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/editorial";
import { formatDate } from "@/lib/date";
import {
  CONTENT_RULE_ACTIONS,
  MAX_CRITERION_CHARS,
  SCOPE_LABELS,
  contentRuleCoversSender,
  messageHrefForPlacement,
} from "@/lib/mail/content-rules";
import type { ContentRuleListItem } from "@/lib/mail/content-rule-store";
import {
  addContentRuleSender,
  createContentRule,
  deleteContentRule,
  recheckContentRule,
  removeContentRuleSender,
  runContentRules,
  updateContentRule,
} from "@/actions/content-rules";

const SCOPES: SubjectRuleScope[] = ["ADDRESS", "DOMAIN", "SUBDOMAINS"];

const fieldClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function scopeText(scope: SubjectRuleScope, value: string) {
  if (scope === "ADDRESS") return value;
  if (scope === "DOMAIN") return `everyone at ${value}`;
  return `everyone at ${value} and its subdomains`;
}

function SenderFields({
  scope,
  value,
  includeExisting,
  onScope,
  onValue,
  onIncludeExisting,
  disabled,
  idPrefix,
}: {
  scope: SubjectRuleScope;
  value: string;
  includeExisting: boolean;
  onScope: (s: SubjectRuleScope) => void;
  onValue: (v: string) => void;
  onIncludeExisting: (v: boolean) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <select
        id={`${idPrefix}-scope`}
        aria-label="Sender scope"
        value={scope}
        disabled={disabled}
        onChange={(e) => onScope(e.target.value as SubjectRuleScope)}
        className={cn(fieldClass, "sm:w-56")}
      >
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {SCOPE_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        id={`${idPrefix}-value`}
        aria-label={scope === "ADDRESS" ? "Sender address" : "Sender domain"}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onValue(e.target.value)}
        placeholder={scope === "ADDRESS" ? "anna@consult.se" : "consult.se"}
        autoComplete="off"
        spellCheck={false}
        className={fieldClass}
      />
      <select
        id={`${idPrefix}-apply`}
        aria-label="Apply to"
        value={includeExisting ? "existing" : "new"}
        disabled={disabled}
        onChange={(e) => onIncludeExisting(e.target.value === "existing")}
        className={cn(fieldClass, "sm:w-64")}
      >
        <option value="new">Only new mail from now on</option>
        <option value="existing">Also mail from the last 30 days</option>
      </select>
    </div>
  );
}

function ActionSelect({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: ContentRuleAction;
  disabled: boolean;
  onChange: (a: ContentRuleAction) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ContentRuleAction)}
        className={fieldClass}
      >
        {CONTENT_RULE_ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NewRuleForm({
  connections,
  focusSender,
}: {
  connections: { id: string; email: string }[];
  focusSender: string | null;
}) {
  const [criterion, setCriterion] = useState("");
  const [scope, setScope] = useState<SubjectRuleScope>(
    focusSender ? "ADDRESS" : "DOMAIN",
  );
  const [scopeValue, setScopeValue] = useState(focusSender ?? "");
  const [includeExisting, setIncludeExisting] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [onMatch, setOnMatch] = useState<ContentRuleAction>("KEEP");
  const [onNoMatch, setOnNoMatch] = useState<ContentRuleAction>("KEEP");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createContentRule({
        criterion,
        onMatch,
        onNoMatch,
        emailConnectionId: connectionId || null,
        sender: { scope, scopeValue, includeExisting },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCriterion("");
      setScopeValue("");
      setOnMatch("KEEP");
      setOnNoMatch("KEEP");
      toast.success(
        includeExisting
          ? "Rule created. Mail from the last 30 days is being checked."
          : "Rule created. New mail from the sender will be checked.",
      );
      setIncludeExisting(false);
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label
          htmlFor="new-rule-criterion"
          className="mb-1 block text-xs text-muted-foreground"
        >
          What should the model look for?
        </label>
        <textarea
          id="new-rule-criterion"
          value={criterion}
          disabled={isPending}
          onChange={(e) => setCriterion(e.target.value)}
          rows={3}
          maxLength={MAX_CRITERION_CHARS}
          placeholder="Profiles for an assignment with two remote days a week, on-site in Uppsala or Stockholm"
          className={fieldClass}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Mail from</p>
        <SenderFields
          idPrefix="new-rule-sender"
          scope={scope}
          value={scopeValue}
          includeExisting={includeExisting}
          onScope={setScope}
          onValue={setScopeValue}
          onIncludeExisting={setIncludeExisting}
          disabled={isPending}
        />
      </div>
      {connections.length > 1 && (
        <div>
          <label
            htmlFor="new-rule-inbox"
            className="mb-1 block text-xs text-muted-foreground"
          >
            Inbox
          </label>
          <select
            id="new-rule-inbox"
            value={connectionId}
            disabled={isPending}
            onChange={(e) => setConnectionId(e.target.value)}
            className={fieldClass}
          >
            <option value="">All inboxes</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.email}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionSelect
          id="new-rule-on-match"
          label="When it matches"
          value={onMatch}
          disabled={isPending}
          onChange={setOnMatch}
        />
        <ActionSelect
          id="new-rule-on-no-match"
          label="When it does not match"
          value={onNoMatch}
          disabled={isPending}
          onChange={setOnNoMatch}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={isPending || !criterion.trim() || !scopeValue.trim()}
      >
        {isPending ? "Creating…" : "Create rule"}
      </Button>
    </form>
  );
}

function RuleCard({
  rule,
  connections,
  focusSender,
}: {
  rule: ContentRuleListItem;
  connections: { id: string; email: string }[];
  focusSender: string | null;
}) {
  const coversFocus =
    focusSender !== null &&
    contentRuleCoversSender(focusSender, new Date(), rule.senders);
  const [scope, setScope] = useState<SubjectRuleScope>("ADDRESS");
  const [scopeValue, setScopeValue] = useState(
    focusSender && !coversFocus ? focusSender : "",
  );
  const [includeExisting, setIncludeExisting] = useState(false);
  const [onMatch, setOnMatch] = useState<ContentRuleAction>(rule.onMatch);
  const [onNoMatch, setOnNoMatch] = useState<ContentRuleAction>(rule.onNoMatch);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.criterion);
  const [recheck, setRecheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inbox = rule.emailConnectionId
    ? connections.find((c) => c.id === rule.emailConnectionId)?.email
    : null;

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      done?.();
    });
  };

  const saveActions = (next: {
    onMatch?: ContentRuleAction;
    onNoMatch?: ContentRuleAction;
  }) => {
    if (next.onMatch) setOnMatch(next.onMatch);
    if (next.onNoMatch) setOnNoMatch(next.onNoMatch);
    run(
      () => updateContentRule(rule.id, next),
      () => toast.success("Rule updated"),
    );
  };

  const saveCriterion = () => {
    if (draft.trim() === rule.criterion) {
      setEditing(false);
      return;
    }
    run(
      () => updateContentRule(rule.id, { criterion: draft, recheck }),
      () => {
        setEditing(false);
        toast.success(
          recheck
            ? "Rule updated. Its mail is being checked again."
            : "Rule updated. New mail is checked with the new wording.",
        );
      },
    );
  };

  return (
    <article className="space-y-4 border-b border-border py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveCriterion();
              }}
            >
              <textarea
                id={`rule-${rule.id}-criterion`}
                aria-label="What should the model look for?"
                value={draft}
                disabled={isPending}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={MAX_CRITERION_CHARS}
                autoFocus
                className={fieldClass}
              />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={recheck}
                  disabled={isPending}
                  onChange={(e) => setRecheck(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Check mail this rule has already judged again
              </label>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !draft.trim()}
                >
                  {isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-lead text-foreground">{rule.criterion}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {coversFocus && (
              <span className="mr-2 rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary">
                Applies to {focusSender}
              </span>
            )}
            {inbox ? `${inbox} · ` : ""}
            {rule._count.matches} checked · {rule.matches.length}
            {rule.matches.length === 20 ? "+" : ""} matched
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setDraft(rule.criterion);
                setRecheck(false);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () => recheckContentRule(rule.id),
                () =>
                  toast.success(
                    "Mail from the last 30 days is being checked again.",
                  ),
              )
            }
          >
            Re-check last 30 days
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () => deleteContentRule(rule.id),
                () => toast.success("Rule deleted"),
              )
            }
          >
            Delete
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">Mail from</p>
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {rule.senders.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-sm"
            >
              <span title={`Judged from ${formatDate(s.since)}`}>
                {scopeText(s.scope, s.scopeValue)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${s.scopeValue}`}
                disabled={isPending || rule.senders.length === 1}
                onClick={() => run(() => removeContentRuleSender(s.id))}
                className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                addContentRuleSender(rule.id, {
                  scope,
                  scopeValue,
                  includeExisting,
                }),
              () => {
                setScopeValue("");
                toast.success(
                  includeExisting
                    ? "Sender added. Its mail from the last 30 days is being checked."
                    : "Sender added. Its new mail will be checked.",
                );
                setIncludeExisting(false);
              },
            );
          }}
        >
          <div className="flex-1">
            <SenderFields
              idPrefix={`rule-${rule.id}-sender`}
              scope={scope}
              value={scopeValue}
              includeExisting={includeExisting}
              onScope={setScope}
              onValue={setScopeValue}
              onIncludeExisting={setIncludeExisting}
              disabled={isPending}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending || !scopeValue.trim()}
            className="sm:h-9"
          >
            Add sender
          </Button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ActionSelect
          id={`rule-${rule.id}-on-match`}
          label="When it matches"
          value={onMatch}
          disabled={isPending}
          onChange={(a) => saveActions({ onMatch: a })}
        />
        <ActionSelect
          id={`rule-${rule.id}-on-no-match`}
          label="When it does not match"
          value={onNoMatch}
          disabled={isPending}
          onChange={(a) => saveActions({ onNoMatch: a })}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rule.matches.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Matched mail</p>
          <ul className="divide-y divide-border">
            {rule.matches.map((m) => (
              <li key={m.id} className="py-2">
                <Link
                  href={messageHrefForPlacement(m.message)}
                  className="block rounded-md focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.message.subject || "(no subject)"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDate(m.message.receivedAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.message.fromName || m.message.fromAddress}
                    {m.reason ? ` · ${m.reason}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function ContentRulesView({
  rules,
  connections,
  modelConnected,
  focusSender,
}: {
  rules: ContentRuleListItem[];
  connections: { id: string; email: string }[];
  modelConnected: boolean;
  /** Address the thread view linked with: prefilled and its rules listed first. */
  focusSender: string | null;
}) {
  const [isChecking, startChecking] = useTransition();
  const now = new Date();
  const covering = focusSender
    ? rules.filter((r) => contentRuleCoversSender(focusSender, now, r.senders))
    : [];
  const ordered = focusSender
    ? [...covering, ...rules.filter((r) => !covering.includes(r))]
    : rules;

  const checkNow = () => {
    startChecking(async () => {
      const result = await runContentRules();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        "Checking in the background. Reload in a moment to see new matches.",
      );
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Describe in plain words what to look for in mail from a sender. Kurir
        asks your draft-generation model about each new message from that sender
        and files it by the answer.
      </p>

      {focusSender && (
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <p>
            <span className="font-medium text-foreground">{focusSender}</span>
            <span className="text-muted-foreground">
              {" · "}
              {covering.length === 0
                ? "no rule checks this sender yet"
                : `${covering.length} ${covering.length === 1 ? "rule checks" : "rules check"} this sender`}
            </span>
          </p>
          <Link
            href="/filters"
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Show all rules
          </Link>
        </div>
      )}

      {!modelConnected && (
        <div className="mt-4 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium text-foreground">No model connected</p>
          <p className="mt-1 text-muted-foreground">
            Rules are saved but nothing is checked until a draft-generation
            token is connected in{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        </div>
      )}

      <section className="mt-8">
        <SectionHeading eyebrow="New" title="Add a rule" />
        <div className="mt-4">
          <NewRuleForm connections={connections} focusSender={focusSender} />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading eyebrow="Active" title="Your rules" />
          {rules.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isChecking || !modelConnected}
              onClick={checkNow}
            >
              <Sparkles className="h-4 w-4" />
              {isChecking ? "Checking…" : "Check now"}
            </Button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No rules yet.</p>
        ) : (
          <div className="mt-2">
            {ordered.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                connections={connections}
                focusSender={focusSender}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
