"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, Loader2, Sparkles } from "lucide-react";
import type { ContentRuleAction } from "@prisma/client";
import {
  addContentRuleSender,
  createContentRule,
  listContentRulesForPicker,
} from "@/actions/content-rules";
import {
  CONTENT_RULE_ACTIONS,
  MAX_CRITERION_CHARS,
} from "@/lib/mail/content-rules";
import {
  subjectScopeOptions,
  type SubjectScopeOption,
} from "@/lib/mail/subject-rules";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PickerRule = Awaited<ReturnType<typeof listContentRulesForPicker>>[number];

const fieldClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";

/** Display form of a scope option: `*.github.com` for the wildcard scope. */
function scopeLabel(option: SubjectScopeOption): string {
  return option.scope === "SUBDOMAINS"
    ? `*.${option.scopeValue}`
    : option.scopeValue;
}

/**
 * "AI rule" from a mail row or an open mail: put the sender's address or
 * domain under a new AI rule, or add it to an existing one. The scope picker
 * mirrors Screen subject (this sender / domain / *.domain). Mirrors the
 * iOS/Mac AIRuleSenderSheet.
 */
export function AIRuleMenu({
  senderEmail,
  trigger,
}: {
  senderEmail: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [includeExisting, setIncludeExisting] = useState(true);
  const [rules, setRules] = useState<PickerRule[] | null>(null);
  const [criterion, setCriterion] = useState("");
  const [onMatch, setOnMatch] = useState<ContentRuleAction>("IMBOX");
  const [onNoMatch, setOnNoMatch] = useState<ContentRuleAction>("KEEP");
  const [addingRuleId, setAddingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = subjectScopeOptions(senderEmail);
  const option = options[scopeIndex] ?? options[0];

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreating(false);
      setError(null);
      return;
    }
    setRules(null);
    listContentRulesForPicker()
      .then(setRules)
      .catch(() => {
        setRules([]);
        setError("Could not load AI Rules.");
      });
  };

  const covers = (rule: PickerRule) =>
    rule.senders.some(
      (s) => s.scope === option.scope && s.scopeValue === option.scopeValue,
    );

  const sender = () => ({
    scope: option.scope,
    scopeValue: option.scopeValue,
    includeExisting,
  });

  const finish = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    router.refresh();
  };

  const add = (rule: PickerRule) => {
    setError(null);
    setAddingRuleId(rule.id);
    startTransition(async () => {
      const result = await addContentRuleSender(rule.id, sender());
      setAddingRuleId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      finish(`Added ${scopeLabel(option)} to the rule.`);
    });
  };

  const create = () => {
    setError(null);
    startTransition(async () => {
      const result = await createContentRule({
        criterion,
        onMatch,
        onNoMatch,
        emailConnectionId: null,
        sender: sender(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCriterion("");
      finish("Rule created.");
    });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* React bubbles portal events to the trigger's ancestors: a list
          row's action bar cancels clicks, which would block the checkbox
          and the form submit here. */}
      <PopoverContent
        align="end"
        className="w-80 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1 text-sm font-medium text-foreground">
          {creating && (
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={isPending}
              aria-label="Back"
              className="-ml-1 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {creating ? "New rule" : "AI rule"}
        </div>
        <label
          htmlFor="ai-rule-scope"
          className="mb-1 block text-xs text-muted-foreground"
        >
          From
        </label>
        <select
          id="ai-rule-scope"
          value={scopeIndex}
          onChange={(e) => setScopeIndex(Number(e.target.value))}
          disabled={isPending}
          className={`mb-2 ${fieldClass}`}
        >
          {options.map((o, i) => (
            <option key={scopeLabel(o)} value={i}>
              {o.scope === "ADDRESS"
                ? o.scopeValue
                : `Everyone at ${scopeLabel(o)}`}
            </option>
          ))}
        </select>
        <label className="mb-3 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={includeExisting}
            onChange={(e) => setIncludeExisting(e.target.checked)}
            disabled={isPending}
          />
          Also mail from the last 30 days
        </label>

        {creating ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <textarea
              value={criterion}
              onChange={(e) => setCriterion(e.target.value)}
              placeholder="What should the model look for?"
              maxLength={MAX_CRITERION_CHARS}
              rows={4}
              disabled={isPending}
              autoFocus
              className={fieldClass}
            />
            <ActionSelect
              id="ai-rule-on-match"
              label="When it matches"
              value={onMatch}
              disabled={isPending}
              onChange={setOnMatch}
            />
            <ActionSelect
              id="ai-rule-on-no-match"
              label="When it does not match"
              value={onNoMatch}
              disabled={isPending}
              onChange={setOnNoMatch}
            />
            <button
              type="submit"
              disabled={isPending || !criterion.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              New rule…
            </button>
            <div className="mb-1 text-xs text-muted-foreground">
              Add to a rule
            </div>
            {rules === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI rules yet.</p>
            ) : (
              <ul className="max-h-60 space-y-0.5 overflow-auto">
                {rules.map((rule) => {
                  const covered = covers(rule);
                  return (
                    <li key={rule.id}>
                      <button
                        type="button"
                        onClick={() => add(rule)}
                        disabled={covered || isPending}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted disabled:hover:bg-transparent"
                      >
                        <span className="line-clamp-2 flex-1">
                          {rule.criterion}
                        </span>
                        {addingRuleId === rule.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          covered && (
                            <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
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
