import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SectionHeading } from "@/components/ui/editorial";
import { auth } from "@/lib/auth";
import { fetchCimd, mcpResourceUri } from "@/lib/mcp/oauth";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function AuthorizeError({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <AuthShell>
      <div className="space-y-4">
        <SectionHeading eyebrow="Claude / MCP" title={title} />
        <p
          role="alert"
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {message}
        </p>
      </div>
    </AuthShell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const responseType = first(params.response_type);
  const challengeMethod = first(params.code_challenge_method);
  const codeChallenge = first(params.code_challenge);
  const clientId = first(params.client_id);
  const redirectUri = first(params.redirect_uri);
  const resource = first(params.resource);
  const state = first(params.state);

  if (
    responseType !== "code" ||
    challengeMethod !== "S256" ||
    !codeChallenge ||
    !clientId ||
    !redirectUri ||
    !resource
  ) {
    return (
      <AuthorizeError
        title="Invalid request"
        message="This authorization request is missing required parameters or is not supported."
      />
    );
  }

  if (resource !== mcpResourceUri()) {
    return (
      <AuthorizeError
        title="Wrong resource"
        message="This app requested access to a different resource than this Kurir instance."
      />
    );
  }

  const doc = await fetchCimd(clientId);
  if (!doc) {
    return (
      <AuthorizeError
        title="Unknown app"
        message="This app could not be verified. The client metadata document is missing or invalid."
      />
    );
  }

  if (!doc.redirect_uris.includes(redirectUri)) {
    return (
      <AuthorizeError
        title="Invalid redirect"
        message="This app requested a redirect that is not allowed."
      />
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    const next = `/oauth/authorize?${new URLSearchParams({
      response_type: responseType,
      code_challenge_method: challengeMethod,
      code_challenge: codeChallenge,
      client_id: clientId,
      redirect_uri: redirectUri,
      resource,
      ...(state ? { state } : {}),
    }).toString()}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const clientName = doc.client_name?.trim() || "This app";

  return (
    <AuthShell>
      <div className="space-y-6">
        <SectionHeading eyebrow="Claude / MCP" title="Connect an app" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {clientName} wants mail and your account settings on this Kurir
          instance.
        </p>
        <ConsentForm
          clientId={clientId}
          redirectUri={redirectUri}
          codeChallenge={codeChallenge}
          resource={resource}
          state={state || undefined}
        />
      </div>
    </AuthShell>
  );
}
