"use client";

import { useActionState } from "react";
import { submitMcpConsent } from "@/actions/mcp-oauth";
import { Button } from "@/components/ui/button";

export function ConsentForm({
  clientId,
  redirectUri,
  codeChallenge,
  resource,
  state,
}: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  state?: string;
}) {
  const [error, action] = useActionState(submitMcpConsent, null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="redirect_uri" value={redirectUri} />
      <input type="hidden" name="code_challenge" value={codeChallenge} />
      <input type="hidden" name="resource" value={resource} />
      {state ? <input type="hidden" name="state" value={state} /> : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Button
        className="w-full"
        size="lg"
        type="submit"
        name="decision"
        value="approve"
      >
        Approve
      </Button>
      <Button
        className="w-full"
        size="lg"
        type="submit"
        name="decision"
        value="deny"
        variant="outline"
      >
        Deny
      </Button>
    </form>
  );
}
