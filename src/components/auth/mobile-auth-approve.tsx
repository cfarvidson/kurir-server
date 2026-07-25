"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Approval step for the iOS web-session login flow. Rendered inside
 * ASWebAuthenticationSession on the server's own origin. Approve mints a
 * one-time code bound to the app's PKCE challenge and hands it back through
 * the kurir:// callback scheme; Deny returns an error the app can surface.
 */
export function MobileAuthApprove({
  codeChallenge,
  deviceName,
}: {
  codeChallenge: string | null;
  deviceName: string | null;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const device = deviceName?.trim() || "your device";

  const handleApprove = async () => {
    if (!codeChallenge) return;
    setState("working");
    setError(null);

    try {
      const res = await fetch("/api/mobile/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeChallenge }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not approve sign-in.");
      }

      const { code } = await res.json();
      window.location.href = `kurir://auth?code=${encodeURIComponent(code)}`;
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    }
  };

  const handleDeny = () => {
    window.location.href = "kurir://auth?error=denied";
  };

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6"
      >
        <div>
          <p className="eyebrow text-muted-foreground">Device sign-in</p>
          <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
            Approve this device?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to Kurir on <strong className="text-foreground">{device}</strong>?
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

        {!codeChallenge ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            This sign-in link is missing or invalid. Start again from the Kurir
            app.
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              className="w-full"
              size="lg"
              onClick={handleApprove}
              disabled={state === "working"}
            >
              {state === "working" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Approve
                </>
              )}
            </Button>

            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={handleDeny}
              disabled={state === "working"}
            >
              Deny
            </Button>
          </div>
        )}
      </motion.div>
    </AuthShell>
  );
}
