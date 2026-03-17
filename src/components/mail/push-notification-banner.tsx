"use client";

import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

const DISMISSED_KEY = "kurir:push-banner-dismissed";

function isIosNonPwa(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    "standalone" in navigator && (navigator as { standalone?: boolean }).standalone;
  return isIos && !isStandalone;
}

export function PushNotificationBanner() {
  const { isSupported, permission, isSubscribed, subscribe } =
    usePushNotifications();
  const [dismissed, setDismissed] = useState(true); // hidden by default until mounted
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISSED_KEY);
    setDismissed(!!wasDismissed);
  }, []);

  // Don't show if: not supported, already subscribed, or dismissed
  if (!isSupported || isSubscribed || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  const handleEnable = async () => {
    setLoading(true);
    try {
      await subscribe();
    } catch {
      // Permission denied or error — banner stays for retry
    } finally {
      setLoading(false);
    }
  };

  const iosPwa = isIosNonPwa();
  const isDenied = permission === "denied";

  return (
    <div className="flex items-center gap-3 border-b bg-primary/5 px-4 py-3 text-sm md:px-6">
      <Bell className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">
        {isDenied ? (
          "Notifications are blocked. Enable them in your browser settings."
        ) : iosPwa ? (
          <>
            To get notifications, add Kurir to your Home Screen: tap{" "}
            <strong>Share</strong> then <strong>Add to Home Screen</strong>.
          </>
        ) : (
          "Get notified when new emails arrive."
        )}
      </span>
      {!isDenied && !iosPwa && (
        <button
          onClick={handleEnable}
          disabled={loading}
          className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Enabling..." : "Enable"}
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
