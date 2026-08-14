"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2 } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

type LoginState = "idle" | "waiting" | "loading" | "error";

export default function LoginForm({
  demoLoginEnabled = false,
}: {
  demoLoginEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [demoEmail, setDemoEmail] = useState("");
  const [demoPassword, setDemoPassword] = useState("");

  // Attempt conditional/autofill passkey on mount (discoverable credential)
  useEffect(() => {
    let cancelled = false;

    const tryConditional = async () => {
      if (typeof window === "undefined") return;
      if (!window.PublicKeyCredential) return;

      // Only attempt if browser supports conditional mediation
      const available =
        await PublicKeyCredential.isConditionalMediationAvailable?.();
      if (!available || cancelled) return;

      try {
        const optionsRes = await fetch("/api/auth/webauthn/login/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!optionsRes.ok || cancelled) return;

        const { options } = await optionsRes.json();
        const { startAuthentication } = await import("@simplewebauthn/browser");

        // This waits for the user to select a passkey from the browser autofill UI
        const credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });
        if (cancelled) return;

        await handleVerify(credential);
      } catch {
        // Conditional mediation was cancelled or failed silently — that's fine
      }
    };

    tryConditional();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Return to the intended destination if one was passed (validated to a
  // same-origin path — no open redirect; backslashes rejected since URL
  // parsing folds "/\evil.com" into "//evil.com"), otherwise the inbox.
  const redirectAfterLogin = () => {
    const next = searchParams.get("next");
    const dest =
      next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
        ? next
        : "/imbox";
    router.push(dest);
    router.refresh();
  };

  const handleDemoLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setError(null);

    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: demoEmail, password: demoPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sign-in failed. Please try again.");
      }

      redirectAfterLogin();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Please try again.",
      );
    }
  };

  const handleVerify = async (credential: AuthenticationResponseJSON) => {
    setState("loading");
    setError(null);

    try {
      const verifyRes = await fetch("/api/auth/webauthn/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || "Sign-in failed. Please try again.");
      }

      redirectAfterLogin();
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Please try again.",
      );
    }
  };

  const handleSignIn = async () => {
    setState("waiting");
    setError(null);

    try {
      const optionsRes = await fetch("/api/auth/webauthn/login/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!optionsRes.ok) {
        throw new Error("Could not start sign-in. Please try again.");
      }

      const { options } = await optionsRes.json();
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const credential = await startAuthentication({ optionsJSON: options });

      await handleVerify(credential);
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setState("idle");
        setError("Sign-in was cancelled.");
      } else {
        setState("error");
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      }
    }
  };

  const isWorking = state === "waiting" || state === "loading";

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6"
      >
        <div>
          <p className="eyebrow text-muted-foreground">Sign in</p>
          <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {demoLoginEnabled
              ? "Sign in to Kurir with the demo credentials."
              : "Sign in to Kurir with your passkey."}
          </p>
        </div>

        {error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive overflow-hidden"
          >
            {error}
          </motion.div>
        )}

        <div className="space-y-4">
          {/* Demo-instance password sign-in (DEMO_LOGIN_* set on server) —
              rendered FIRST as the primary action so it is visible without
              scrolling in small viewports (App Store reviewers open this
              page inside a narrow ASWebAuthenticationSession sheet). */}
          {demoLoginEnabled && (
            <form onSubmit={handleDemoLogin} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Demo instance — sign in with the demo credentials.
              </p>
              <input
                type="email"
                required
                value={demoEmail}
                onChange={(e) => setDemoEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                type="password"
                required
                value={demoPassword}
                onChange={(e) => setDemoPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isWorking}
              >
                {state === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Sign in with demo account
              </Button>
            </form>
          )}

          {/* Passkey sign-in — the primary action on real instances,
              secondary below a divider on demo instances */}
          <div
            className={
              demoLoginEnabled
                ? "space-y-4 border-t border-border pt-4"
                : "space-y-4"
            }
          >
            <Button
              variant={demoLoginEnabled ? "secondary" : "default"}
              className="w-full"
              size="lg"
              onClick={handleSignIn}
              disabled={isWorking}
            >
              {isWorking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {state === "waiting"
                    ? "Waiting for passkey..."
                    : "Signing in..."}
                </>
              ) : (
                <>
                  <Fingerprint className="h-4 w-4" />
                  Sign in with passkey
                </>
              )}
            </Button>

            {/* Hint for conditional UI / autofill */}
            <p className="text-xs text-muted-foreground">
              Your browser may also prompt you automatically with a saved
              passkey.
            </p>

            {/*
              Passkey autofill target — hidden input for browsers that support
              conditional mediation. The browser attaches the autofill UI here.
            */}
            <input
              type="text"
              autoComplete="username webauthn"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              readOnly
            />
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            New to Kurir?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            {" · "}
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            {" · "}
            <Link href="/support" className="hover:underline">
              Support
            </Link>
          </p>
        </div>
      </motion.div>
    </AuthShell>
  );
}
