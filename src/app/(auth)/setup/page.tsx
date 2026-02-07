"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { Mail, Lock, Server, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

const PROVIDERS = [
  { id: "gmail", name: "Gmail", domain: "gmail.com" },
  { id: "outlook", name: "Outlook / Hotmail", domain: "outlook.com" },
  { id: "icloud", name: "iCloud", domain: "icloud.com" },
  { id: "yahoo", name: "Yahoo", domain: "yahoo.com" },
  { id: "custom", name: "Other / Custom", domain: null },
];

export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState("gmail");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectProvider = (email: string) => {
    const domain = email.split("@")[1]?.toLowerCase();
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
    setLoading(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        provider: provider !== "custom" ? provider : undefined,
        imapHost: showAdvanced ? imapHost : undefined,
        imapPort: showAdvanced ? imapPort : undefined,
        smtpHost: showAdvanced ? smtpHost : undefined,
        smtpPort: showAdvanced ? smtpPort : undefined,
        redirect: false,
      });

      if (result?.error) {
        setError("Could not connect. Please check your credentials and server settings.");
      } else {
        router.push("/imbox");
        router.refresh();
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-white p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Connect your email</CardTitle>
          <CardDescription>
            Link your email account to get started with Kurir
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
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
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Your email password or app password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                For Gmail/Outlook, you may need to use an{" "}
                <a
                  href="https://support.google.com/accounts/answer/185833"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  app password
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Email Provider</Label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  if (e.target.value === "custom") {
                    setShowAdvanced(true);
                  }
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

            {provider === "custom" || showAdvanced ? (
              <div className="space-y-4 rounded-md border bg-muted/50 p-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex w-full items-center justify-between text-sm font-medium"
                >
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Server Settings
                  </span>
                  {showAdvanced ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {showAdvanced && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <Label htmlFor="imapHost" className="text-xs">
                          IMAP Host
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
                          SMTP Host
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
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Server className="h-3 w-3" />
                Show advanced settings
              </button>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect Account"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already connected?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
