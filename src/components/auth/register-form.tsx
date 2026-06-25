"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Fingerprint, Mail, Loader2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

type Step = "intro" | "name" | "passkey" | "done";

interface RegisterFormProps {
  inviteToken?: string;
  inviteDisplayName?: string;
}

export default function RegisterForm({
  inviteToken,
  inviteDisplayName,
}: RegisterFormProps = {}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(inviteDisplayName ? "name" : "intro");
  const [displayName, setDisplayName] = useState(inviteDisplayName || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setStep("passkey");
  };

  const handleRegisterPasskey = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Get registration options from server
      const optionsUrl = inviteToken
        ? `/api/auth/webauthn/register/options?invite=${encodeURIComponent(inviteToken)}`
        : "/api/auth/webauthn/register/options";
      const optionsRes = await fetch(optionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json().catch(() => ({}));
        throw new Error(
          data.error || "Could not start registration. Please try again.",
        );
      }

      const { options } = await optionsRes.json();

      // 2. Browser creates credential (dynamic import to avoid SSR issues)
      const { startRegistration } = await import("@simplewebauthn/browser");
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Verify with server — send the credential directly as the body
      const verifyUrl = inviteToken
        ? `/api/auth/webauthn/register/verify?invite=${encodeURIComponent(inviteToken)}`
        : "/api/auth/webauthn/register/verify";
      const verifyRes = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || "Registration failed. Please try again.");
      }

      setStep("done");
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey creation was cancelled. Please try again.");
      } else if (err instanceof Error && err.name === "InvalidStateError") {
        setError("A passkey for this account already exists on this device.");
      } else {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AnimatePresence mode="wait">
        {step === "intro" && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <div>
              <p className="eyebrow text-muted-foreground">Get started</p>
              <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
                Create your account
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Kurir uses passkeys for secure, passwordless sign-in. No master
                password to remember or lose.
              </p>
            </div>

            <ol className="space-y-4 border-t border-border pt-5">
              <li className="flex items-baseline gap-3">
                <span className="text-eyebrow font-semibold text-primary tabular-nums">
                  01
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Create your passkey
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your device (Touch ID, Face ID, or security key) becomes
                    your login.
                  </p>
                </div>
              </li>
              <li className="flex items-baseline gap-3">
                <span className="text-eyebrow font-semibold text-primary tabular-nums">
                  02
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Connect your email
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Link one or more email accounts via IMAP/SMTP.
                  </p>
                </div>
              </li>
            </ol>

            <Button className="w-full" onClick={() => setStep("name")}>
              Get started
              <ChevronRight className="h-4 w-4" />
            </Button>

            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </motion.div>
        )}

        {step === "name" && (
          <motion.div
            key="name"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <div>
              <p className="eyebrow text-muted-foreground">Your name</p>
              <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
                What should we call you?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This name appears in email replies you send.
              </p>
            </div>

            <form onSubmit={handleNameSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Your name</Label>
                <Input
                  id="displayName"
                  placeholder="Alex Smith"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!displayName.trim()}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="flex w-full justify-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
            </form>
          </motion.div>
        )}

        {step === "passkey" && (
          <motion.div
            key="passkey"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <div>
              <p className="eyebrow text-muted-foreground">Secure your account</p>
              <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
                Create your passkey
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your browser will ask you to authenticate with Touch ID, Face
                ID, Windows Hello, or a hardware security key.
              </p>
            </div>

            <div className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Creating passkey for{" "}
                <span className="font-medium text-foreground">
                  {displayName}
                </span>
              </p>

              <Button
                className="w-full"
                onClick={handleRegisterPasskey}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating passkey...
                  </>
                ) : (
                  <>
                    <Fingerprint className="h-4 w-4" />
                    Create passkey
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setStep("name")}
                className="flex w-full justify-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
            </div>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.25 }}
            className="space-y-6"
          >
            <div>
              <p className="eyebrow text-primary">Account secured</p>
              <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
                You&apos;re in, {displayName.split(" ")[0]}!
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your account is secured with a passkey. Now connect your first
                email account to get started.
              </p>
            </div>

            <Button className="w-full" onClick={() => router.push("/setup")}>
              <Mail className="h-4 w-4" />
              Connect email account
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
