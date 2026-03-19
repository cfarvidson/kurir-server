"use client";

/**
 * PasskeysList — renders the list of registered passkeys in settings.
 * Manages registration of new passkeys and removal of existing ones.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasskeyCard, type PasskeyInfo } from "./passkey-card";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2, Plus } from "lucide-react";

interface PasskeysListProps {
  passkeys: PasskeyInfo[];
}

export function PasskeysList({ passkeys }: PasskeysListProps) {
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAddPasskey = async () => {
    setRegistering(true);
    setError(null);

    try {
      // Get registration options for an already-authenticated user
      const optionsRes = await fetch(
        "/api/auth/webauthn/register/options?addPasskey=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!optionsRes.ok) {
        throw new Error("Could not start passkey registration.");
      }

      const options = await optionsRes.json();
      const { startRegistration } = await import("@simplewebauthn/browser");
      // v13 API: startRegistration expects { optionsJSON }; server returns { options }
      const credential = await startRegistration({ optionsJSON: options.options });

      const verifyRes = await fetch(
        "/api/auth/webauthn/register/verify?addPasskey=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        }
      );

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || "Passkey registration failed.");
      }

      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Passkey creation was cancelled.");
      } else if (err instanceof Error && err.name === "InvalidStateError") {
        setError("This device already has a passkey registered.");
      } else {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred."
        );
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    startTransition(async () => {
      await fetch(`/api/auth/webauthn/passkeys/${id}`, {
        method: "DELETE",
      });
      router.refresh();
    });
  };

  const handleRename = async (id: string, name: string) => {
    await fetch(`/api/auth/webauthn/passkeys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {passkeys.map((pk) => (
        <PasskeyCard
          key={pk.id}
          passkey={pk}
          onDelete={handleDelete}
          onRename={handleRename}
          isOnly={passkeys.length === 1}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={handleAddPasskey}
        disabled={registering || isPending}
        className="gap-1.5 w-full"
        aria-label="Register another passkey for this account"
      >
        {registering ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating passkey...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" />
            <Fingerprint className="h-4 w-4" />
            Add passkey
          </>
        )}
      </Button>
    </div>
  );
}
