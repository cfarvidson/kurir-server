"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
  Mail,
  Lock,
  Server,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

const PROVIDERS = [
  { id: "gmail", name: "Gmail", domain: "gmail.com" },
  { id: "outlook", name: "Outlook / Hotmail", domain: "outlook.com" },
  { id: "icloud", name: "iCloud", domain: "icloud.com" },
  { id: "yahoo", name: "Yahoo", domain: "yahoo.com" },
  { id: "custom", name: "Other / Custom", domain: null },
];

type VerifyState = "idle" | "verifying" | "success" | "error";

export default function AddConnectionPage() {
  return (
    <Suspense>
      <AddConnectionForm />
    </Suspense>
  );
}

function AddConnectionForm() {
  const searchParams = useSearchParams();
  const isAddMode = searchParams.get("mode") === "add";
  const router = useRouter();
  const successRedirect = isAddMode ? "/settings" : "/imbox";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState("gmail");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [sendAsEmail, setSendAsEmail] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAliasInput, setNewAliasInput] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [error, setError] = useState<string | null>(null);

  const detectProvider = (emailValue: string) => {
    const domain = emailValue.split("@")[1]?.toLowerCase();
    if (!domain) return;

    for (const p of PROVIDERS) {
      if (p.domain && domain.includes(p.domain.split(".")[0])) {
        setProvider(p.id);
        return;
      }
    }
    setProvider("custom");
    setShowAdvanced(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyState("verifying");
    setError(null);

    try {
      const body: Record<string, string | string[]> = {
        email,
        password,
        displayName: displayName || email,
      };

      if (provider !== "custom") {
        body.provider = provider;
      }

      if (showAdvanced) {
        body.imapHost = imapHost;
        body.imapPort = imapPort;
        body.smtpHost = smtpHost;
        body.smtpPort = smtpPort;
      }

      if (sendAsEmail.trim()) {
        body.sendAsEmail = sendAsEmail.trim();
      }

      if (aliases.length > 0) {
        body.aliases = aliases;
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
            "Could not connect. Please check your credentials and server settings."
        );
      }

      setVerifyState("success");
      setTimeout(() => {
        router.push(successRedirect);
        router.refresh();
      }, 1200);
    } catch (err) {
      setVerifyState("error");
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    }
  };

  const isLoading = verifyState === "verifying";
  const isSuccess = verifyState === "success";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-white p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-2xl">
              {isAddMode ? "Add another email" : "Connect your first email account"}
            </CardTitle>
            <CardDescription>
              {isAddMode
                ? "Add another email account to your Kurir inbox."
                : "Add your first email account to start receiving mail in Kurir."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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

              {/* Display name */}
              <div className="space-y-2">
                <Label htmlFor="displayName">
                  Display name{" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  id="displayName"
                  placeholder="Work email, Personal, etc."
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

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
                  For Gmail and Outlook, use an{" "}
                  <a
                    href="https://support.google.com/accounts/answer/185833"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    app password
                  </a>
                  .
                </p>
              </div>

              {/* Send-as & aliases */}
              <div className="space-y-2">
                <Label htmlFor="sendAsEmail">
                  Send-as email{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="sendAsEmail"
                  type="email"
                  placeholder="you@yourdomain.com"
                  value={sendAsEmail}
                  onChange={(e) => setSendAsEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If you send from a different address than you log in with
                  (e.g. custom domain via iCloud), enter it here.
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Additional aliases{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Other email addresses you own. Messages from these won&apos;t
                  appear in the Screener.
                </p>
                {aliases.length > 0 && (
                  <div className="space-y-1">
                    {aliases.map((alias) => (
                      <div
                        key={alias}
                        className="flex items-center justify-between rounded-md border px-3 py-1.5"
                      >
                        <span className="text-sm">{alias}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAliases((prev) => prev.filter((a) => a !== alias))
                          }
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="old-address@example.com"
                    value={newAliasInput}
                    onChange={(e) => setNewAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = newAliasInput.trim().toLowerCase();
                        if (trimmed && trimmed.includes("@") && !aliases.includes(trimmed)) {
                          setAliases((prev) => [...prev, trimmed]);
                          setNewAliasInput("");
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const trimmed = newAliasInput.trim().toLowerCase();
                      if (trimmed && trimmed.includes("@") && !aliases.includes(trimmed)) {
                        setAliases((prev) => [...prev, trimmed]);
                        setNewAliasInput("");
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>

              {/* Provider */}
              <div className="space-y-2">
                <Label htmlFor="provider">Email provider</Label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    if (e.target.value === "custom") setShowAdvanced(true);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Advanced settings */}
              <div className="rounded-md border bg-muted/50">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Server className="h-4 w-4" />
                    Server settings
                  </span>
                  {showAdvanced ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 border-t px-4 py-3">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2">
                            <Label htmlFor="imapHost" className="text-xs">
                              IMAP host
                            </Label>
                            <Input
                              id="imapHost"
                              placeholder="imap.example.com"
                              value={imapHost}
                              onChange={(e) => setImapHost(e.target.value)}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label htmlFor="imapPort" className="text-xs">
                              Port
                            </Label>
                            <Input
                              id="imapPort"
                              placeholder="993"
                              value={imapPort}
                              onChange={(e) => setImapPort(e.target.value)}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2">
                            <Label htmlFor="smtpHost" className="text-xs">
                              SMTP host
                            </Label>
                            <Input
                              id="smtpHost"
                              placeholder="smtp.example.com"
                              value={smtpHost}
                              onChange={(e) => setSmtpHost(e.target.value)}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label htmlFor="smtpPort" className="text-xs">
                              Port
                            </Label>
                            <Input
                              id="smtpPort"
                              placeholder="587"
                              value={smtpPort}
                              onChange={(e) => setSmtpPort(e.target.value)}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Submit */}
              <Button type="submit" className="w-full" disabled={isLoading || isSuccess}>
                {isSuccess ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Connected!
                  </>
                ) : isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying connection...
                  </>
                ) : (
                  "Connect account"
                )}
              </Button>

              {isAddMode ? (
                <p className="text-center text-sm text-muted-foreground">
                  <Link
                    href="/settings"
                    className="hover:text-foreground transition-colors"
                  >
                    Back to settings
                  </Link>
                </p>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  <Link
                    href="/imbox"
                    className="hover:text-foreground transition-colors"
                  >
                    Skip for now
                  </Link>
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
