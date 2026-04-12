"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Fingerprint,
  Mail,
  Lock,
  Server,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { KurirLogo } from "@/components/logo";
import { EMAIL_PROVIDERS, detectProviderFromEmail } from "@/lib/mail/providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = "welcome" | "passkey" | "email" | "syncing" | "done";

interface SetupWizardProps {
  oauthEnabled?: { microsoft: boolean; google: boolean };
}

interface SyncResultEntry {
  newMessages?: number;
  remaining?: number;
  totalOnServer?: number;
  totalCached?: number;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "welcome", label: "Account" },
  { key: "email", label: "Email" },
  { key: "syncing", label: "Sync" },
  { key: "done", label: "Done" },
];

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex(
    (s) => s.key === current || (current === "passkey" && s.key === "welcome"),
  );

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((step, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isComplete
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                    : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isComplete ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-[10px] mt-1 ${
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-8 mb-4 ${
                  isComplete
                    ? "bg-emerald-300 dark:bg-emerald-700"
                    : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function SetupWizard({ oauthEnabled }: SetupWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [error, setError] = useState<string | null>(null);

  // Account step
  const [displayName, setDisplayName] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Email step
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState("gmail");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [emailVerifying, setEmailVerifying] = useState(false);

  // Sync step
  const [syncStatus, setSyncStatus] = useState<
    "starting" | "syncing" | "done" | "error"
  >("starting");
  const [syncMessage, setSyncMessage] = useState("");
  const syncCancelledRef = useRef(false);

  const selectedProvider = EMAIL_PROVIDERS.find((p) => p.id === provider);
  const useOAuth =
    selectedProvider?.oauthKey && oauthEnabled?.[selectedProvider.oauthKey];

  // Cancel sync polling on unmount
  useEffect(() => {
    return () => {
      syncCancelledRef.current = true;
    };
  }, []);

  // Cancel sync polling when leaving the syncing step
  const leaveSync = useCallback((nextStep: WizardStep) => {
    syncCancelledRef.current = true;
    setStep(nextStep);
  }, []);

  // ----- Step: Welcome → Passkey -----

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setStep("passkey");
    setError(null);
  };

  const handleCreatePasskey = async () => {
    setPasskeyLoading(true);
    setError(null);

    try {
      const optionsRes = await fetch("/api/auth/webauthn/register/options", {
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
      const { startRegistration } = await import("@simplewebauthn/browser");
      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...credential,
          displayName: displayName.trim(),
        }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || "Registration failed. Please try again.");
      }

      // User is now logged in via session cookie — proceed to email step
      setStep("email");
      setError(null);
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
      setPasskeyLoading(false);
    }
  };

  // ----- Step: Email connection -----

  const detectProvider = (emailValue: string) => {
    setProvider(detectProviderFromEmail(emailValue));
  };

  const handleOAuthConnect = () => {
    if (!selectedProvider?.oauthKey) return;
    window.location.href = `/api/auth/oauth/${selectedProvider.oauthKey}?mode=setup`;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailVerifying(true);
    setError(null);

    try {
      const body: Record<string, string> = {
        email,
        password,
        displayName: email,
      };

      const providerConfig = EMAIL_PROVIDERS.find((p) => p.id === provider);
      if (provider === "custom") {
        body.imapHost = imapHost;
        body.imapPort = imapPort;
        body.smtpHost = smtpHost;
        body.smtpPort = smtpPort;
      } else if (providerConfig?.imap && providerConfig?.smtp) {
        body.imapHost = providerConfig.imap.host;
        body.imapPort = String(providerConfig.imap.port);
        body.smtpHost = providerConfig.smtp.host;
        body.smtpPort = String(providerConfig.smtp.port);
      }

      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.error ||
            "Could not connect. Please check your credentials and server settings.",
        );
      }

      // Connection created — move to sync step
      setStep("syncing");
      setError(null);
      triggerSync();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setEmailVerifying(false);
    }
  };

  // ----- Step: Sync -----

  const triggerSync = useCallback(async () => {
    setSyncStatus("starting");
    syncCancelledRef.current = false;
    setSyncMessage("Starting initial sync...");
    setError(null);

    try {
      const res = await fetch("/api/mail/sync?batchSize=200", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sync failed");
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(
          data.results?.[0]?.error || "Sync completed with errors",
        );
      }

      const results = (data.results?.[0]?.results || []) as SyncResultEntry[];
      const totalNew = results.reduce(
        (sum, r) => sum + (r.newMessages || 0),
        0,
      );
      const totalRemaining = results.reduce(
        (sum, r) => sum + (r.remaining || 0),
        0,
      );
      const totalOnServer = results.reduce(
        (sum, r) => sum + (r.totalOnServer || 0),
        0,
      );

      if (totalRemaining > 0) {
        setSyncStatus("syncing");
        setSyncMessage(
          `Synced ${totalNew} messages. ${totalRemaining} remaining of ${totalOnServer} total.`,
        );
        // Continue syncing remaining messages
        pollForMoreSync();
      } else {
        setSyncStatus("done");
        setSyncMessage(
          totalNew > 0
            ? `Synced ${totalNew} messages across ${results.length} folders.`
            : `${totalOnServer} messages synced.`,
        );
      }
    } catch (err) {
      setSyncStatus("error");
      setSyncMessage(
        err instanceof Error ? err.message : "Sync failed unexpectedly.",
      );
    }
  }, []);

  const pollForMoreSync = useCallback(() => {
    // Continue syncing by triggering another batch
    const doNextBatch = async () => {
      if (syncCancelledRef.current) return;

      try {
        const res = await fetch("/api/mail/sync?batchSize=500", {
          method: "POST",
        });
        if (syncCancelledRef.current) return;

        // Handle rate limiting — wait and retry
        if (res.status === 429) {
          const retryAfter = parseInt(
            res.headers.get("Retry-After") || "30",
            10,
          );
          setSyncMessage("Waiting for rate limit to reset...");
          setTimeout(doNextBatch, retryAfter * 1000);
          return;
        }

        if (!res.ok) {
          setSyncStatus("done");
          setSyncMessage("Initial sync complete.");
          return;
        }

        const data = await res.json();
        const results = (data.results?.[0]?.results || []) as SyncResultEntry[];
        const totalNew = results.reduce(
          (sum, r) => sum + (r.newMessages || 0),
          0,
        );
        const totalRemaining = results.reduce(
          (sum, r) => sum + (r.remaining || 0),
          0,
        );
        const totalCached = results.reduce(
          (sum, r) => sum + (r.totalCached || 0),
          0,
        );
        const totalOnServer = results.reduce(
          (sum, r) => sum + (r.totalOnServer || 0),
          0,
        );

        if (totalRemaining > 0 && !syncCancelledRef.current) {
          setSyncMessage(
            `Synced ${totalCached} of ${totalOnServer} messages. ${totalRemaining} remaining...`,
          );
          // Schedule next batch after a brief pause
          setTimeout(doNextBatch, 1000);
        } else {
          setSyncStatus("done");
          setSyncMessage(
            `Synced ${totalNew > 0 ? totalCached : totalOnServer} messages. All done!`,
          );
        }
      } catch {
        setSyncStatus("done");
        setSyncMessage("Initial sync complete.");
      }
    };

    // Start after a short delay to avoid rate limiting
    setTimeout(doNextBatch, 2000);
  }, []);

  // ----- Step: Done -----

  const handleFinish = () => {
    router.push("/imbox");
    router.refresh();
  };

  // ----- Render -----

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-orange-50 via-amber-50/50 to-stone-50/30 dark:from-stone-950 dark:via-stone-950 dark:to-stone-900 p-4">
      <div className="w-full max-w-md">
        <StepIndicator current={step} />

        <AnimatePresence mode="wait">
          {/* ============ Welcome ============ */}
          {step === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <KurirLogo className="h-8 w-8" />
                  </div>
                  <CardTitle className="text-2xl">Welcome to Kurir</CardTitle>
                  <CardDescription>
                    Let&apos;s set up your email in a few quick steps. First,
                    create your admin account.
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                      <p className="text-xs text-muted-foreground">
                        This appears in emails you send.
                      </p>
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!displayName.trim()}
                    >
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ============ Passkey ============ */}
          {step === "passkey" && (
            <motion.div
              key="passkey"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Fingerprint className="h-7 w-7 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">
                    Create your passkey
                  </CardTitle>
                  <CardDescription>
                    Kurir uses passkeys for secure, passwordless sign-in. Your
                    browser will prompt you to authenticate with Touch ID, Face
                    ID, or a security key.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          {error}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground">
                      Creating admin account for{" "}
                      <span className="font-medium text-foreground">
                        {displayName}
                      </span>
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleCreatePasskey}
                    disabled={passkeyLoading}
                  >
                    {passkeyLoading ? (
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
                    onClick={() => {
                      setStep("welcome");
                      setError(null);
                    }}
                    className="flex w-full justify-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ============ Email ============ */}
          {step === "email" && (
            <motion.div
              key="email"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Mail className="h-7 w-7 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">Connect your email</CardTitle>
                  <CardDescription>
                    Add your email account so Kurir can fetch and send mail.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <form onSubmit={handleEmailSubmit} className="space-y-4">
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {error}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Provider */}
                    <div className="space-y-2">
                      <Label htmlFor="provider">Email provider</Label>
                      <select
                        id="provider"
                        value={provider}
                        onChange={(e) => {
                          setProvider(e.target.value);
                          setError(null);
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {EMAIL_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* OAuth flow */}
                    {useOAuth ? (
                      <div className="space-y-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={handleOAuthConnect}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Sign in with{" "}
                          {selectedProvider?.oauthKey === "microsoft"
                            ? "Microsoft"
                            : "Google"}
                        </Button>
                        <p className="text-xs text-center text-muted-foreground">
                          You will be redirected to{" "}
                          {selectedProvider?.oauthKey === "microsoft"
                            ? "Microsoft"
                            : "Google"}{" "}
                          to authorize access.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Email */}
                        <div className="space-y-2">
                          <Label htmlFor="email">Email address</Label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="email"
                              type="email"
                              placeholder="you@example.com"
                              value={email}
                              onChange={(e) => {
                                setEmail(e.target.value);
                                detectProvider(e.target.value);
                              }}
                              className="pl-10"
                              required
                              autoComplete="email"
                            />
                          </div>
                        </div>

                        {/* Password */}
                        <div className="space-y-2">
                          <Label htmlFor="password">Password</Label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="password"
                              type="password"
                              placeholder="Email password or app password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="pl-10"
                              required
                              autoComplete="current-password"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Use an{" "}
                            <a
                              href="https://support.google.com/accounts/answer/185833"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              app password
                            </a>{" "}
                            if your provider requires it.
                          </p>
                        </div>

                        {/* Custom server settings */}
                        <AnimatePresence>
                          {provider === "custom" && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="rounded-md border bg-muted/50 p-4 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                  <Server className="h-4 w-4" />
                                  Server settings
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="col-span-2">
                                    <Label
                                      htmlFor="imapHost"
                                      className="text-xs"
                                    >
                                      IMAP host
                                    </Label>
                                    <Input
                                      id="imapHost"
                                      placeholder="imap.example.com"
                                      value={imapHost}
                                      onChange={(e) =>
                                        setImapHost(e.target.value)
                                      }
                                      className="h-8 text-sm"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor="imapPort"
                                      className="text-xs"
                                    >
                                      Port
                                    </Label>
                                    <Input
                                      id="imapPort"
                                      placeholder="993"
                                      value={imapPort}
                                      onChange={(e) =>
                                        setImapPort(e.target.value)
                                      }
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                  <div className="col-span-2">
                                    <Label
                                      htmlFor="smtpHost"
                                      className="text-xs"
                                    >
                                      SMTP host
                                    </Label>
                                    <Input
                                      id="smtpHost"
                                      placeholder="smtp.example.com"
                                      value={smtpHost}
                                      onChange={(e) =>
                                        setSmtpHost(e.target.value)
                                      }
                                      className="h-8 text-sm"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor="smtpPort"
                                      className="text-xs"
                                    >
                                      Port
                                    </Label>
                                    <Input
                                      id="smtpPort"
                                      placeholder="587"
                                      value={smtpPort}
                                      onChange={(e) =>
                                        setSmtpPort(e.target.value)
                                      }
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Submit */}
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={emailVerifying}
                        >
                          {emailVerifying ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Verifying connection...
                            </>
                          ) : (
                            <>
                              Connect account
                              <ChevronRight className="h-4 w-4" />
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ============ Syncing ============ */}
          {step === "syncing" && (
            <motion.div
              key="syncing"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    {syncStatus === "done" ? (
                      <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                    ) : syncStatus === "error" ? (
                      <AlertCircle className="h-7 w-7 text-destructive" />
                    ) : (
                      <RefreshCw className="h-7 w-7 text-primary animate-spin" />
                    )}
                  </div>
                  <CardTitle className="text-2xl">
                    {syncStatus === "done"
                      ? "Sync complete"
                      : syncStatus === "error"
                        ? "Sync failed"
                        : "Syncing your email..."}
                  </CardTitle>
                  <CardDescription>
                    {syncStatus === "done"
                      ? "Your messages are ready."
                      : syncStatus === "error"
                        ? "Something went wrong during the initial sync."
                        : "Fetching your messages from the server. This may take a moment."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground text-center">
                      {syncMessage}
                    </p>
                  </div>

                  {syncStatus === "error" && (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={triggerSync}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry sync
                    </Button>
                  )}

                  {syncStatus === "done" && (
                    <Button
                      className="w-full"
                      onClick={() => leaveSync("done")}
                    >
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}

                  {(syncStatus === "starting" || syncStatus === "syncing") && (
                    <button
                      type="button"
                      onClick={() => leaveSync("done")}
                      className="flex w-full justify-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Skip — sync in background
                    </button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ============ Done ============ */}
          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", duration: 0.4, bounce: 0.25 }}
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
                    <Inbox className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <CardTitle className="text-2xl">
                    You&apos;re all set, {displayName.split(" ")[0]}!
                  </CardTitle>
                  <CardDescription>
                    Your Kurir instance is ready. New messages from unknown
                    senders will appear in your Screener for you to approve.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" size="lg" onClick={handleFinish}>
                    <Inbox className="h-4 w-4" />
                    Go to your Imbox
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
