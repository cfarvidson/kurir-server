"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  removeDraftGenerationToken,
  saveDraftGenerationToken,
} from "@/actions/draft-generation";
import type {
  DraftGenerationProvider,
  DraftGenerationStatus,
} from "@/lib/draft-generation/types";
import { DOCS_DRAFT_GENERATION_URL } from "@/lib/docs";

const PROVIDERS: {
  value: DraftGenerationProvider;
  label: string;
  hint: string;
}[] = [
  { value: "claudeCode", label: "Claude Code", hint: "Claude Pro/Max seat" },
  { value: "grokBuild", label: "Grok Build", hint: "SuperGrok seat" },
];

export function providerLabel(provider: DraftGenerationProvider | null) {
  return provider === "grokBuild" ? "Grok Build" : "Claude Code";
}

export function DraftGenerationSettings({
  initial,
}: {
  initial: DraftGenerationStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [provider, setProvider] = useState<DraftGenerationProvider>(
    initial.provider ?? "claudeCode",
  );
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  const handleSave = async () => {
    if (busy) return;
    setBusy("save");
    setError(null);
    try {
      const result = await saveDraftGenerationToken(provider, token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.status);
      setToken("");
      toast.success(`Draft generation connected via ${providerLabel(provider)}`);
    } catch {
      setError("Could not save the token. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy("remove");
    setError(null);
    try {
      const next = await removeDraftGenerationToken();
      setStatus(next);
      toast.success("Draft generation disconnected on every device");
    } catch {
      setError("Could not remove the token. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {status.connected ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">
              Connected via {providerLabel(status.provider)}
            </p>
            <p className="text-xs text-muted-foreground">
              The token is stored encrypted on the server and is never shown
              again. Paste a new one below to replace it.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy === "remove"}
            onClick={() => void handleRemove()}
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Not connected.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {PROVIDERS.map((p) => {
          const selected = provider === p.value;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setProvider(p.value)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-sm font-medium transition-colors ${
                selected
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
              }`}
            >
              {p.label}
              <span className="text-xs font-normal text-muted-foreground">
                {p.hint}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            provider === "claudeCode"
              ? "sk-ant-oat01-…"
              : '{ "access_token": "…", "refresh_token": "…" }'
          }
          className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          {provider === "claudeCode"
            ? "Run `claude setup-token` in a terminal and paste its output. Anthropic Console API keys (sk-ant-api…) are refused — they bill per token."
            : "Sign in with `grok login` and paste the contents of ~/.grok/auth.json. xAI API keys (xai-…) are refused — they bill per token."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <a
            href={DOCS_DRAFT_GENERATION_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Setup guide
          </a>{" "}
          — how to mint a token for either provider.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={busy === "save" || token.trim() === ""}
        onClick={() => void handleSave()}
      >
        {busy === "save" ? "Saving…" : status.connected ? "Replace token" : "Save token"}
      </Button>

      <p className="text-xs text-muted-foreground">
        When you generate a draft, the mail being answered and recent
        correspondence with that sender are sent to Anthropic or xAI using
        your subscription. Nothing is sent until you tap Generate draft.
      </p>
    </div>
  );
}
