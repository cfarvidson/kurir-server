"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Fingerprint, Loader2 } from "lucide-react";
import Link from "next/link";
import { KurirLogo } from "@/components/logo";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";

type LoginState = "idle" | "waiting" | "loading" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState<string | null>(null);

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

      router.push("/imbox");
      router.refresh();
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50/50 to-stone-50/30 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardHeader className="text-center pb-4">
            <KurirLogo className="mx-auto mb-2 h-16 w-16" />
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>
              Sign in to Kurir with your passkey.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive overflow-hidden"
              >
                {error}
              </motion.div>
            )}

            {/* Passkey sign-in button — the primary action */}
            <Button
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
            <p className="text-center text-xs text-muted-foreground">
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

            <div className="border-t pt-4">
              <p className="text-center text-sm text-muted-foreground">
                New to Kurir?{" "}
                <Link href="/register" className="text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
