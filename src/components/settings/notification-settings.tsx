"use client";

import { Bell, BellOff } from "lucide-react";
import {
  usePushNotifications,
  isIosNonPwa,
} from "@/hooks/use-push-notifications";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function NotificationSettings() {
  const { isSupported, permission, isSubscribed, subscribe, unsubscribe } =
    usePushNotifications();
  const [loading, setLoading] = useState(false);

  if (!isSupported) {
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications are not supported in this browser.
      </p>
    );
  }

  const iosPwa = isIosNonPwa();
  const isDenied = permission === "denied";

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (isSubscribed) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {isSubscribed ? (
          <Bell className="h-5 w-5 text-primary" />
        ) : (
          <BellOff className="h-5 w-5 text-muted-foreground" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium">
            {isSubscribed
              ? "Notifications enabled on this device"
              : "Notifications not enabled"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isSubscribed
              ? "You'll receive alerts for new Imbox messages."
              : "Enable to get notified when new emails arrive."}
          </p>
        </div>
        {!isDenied && !iosPwa && (
          <Button
            variant={isSubscribed ? "outline" : "default"}
            size="sm"
            onClick={handleToggle}
            disabled={loading}
          >
            {loading ? "..." : isSubscribed ? "Disable" : "Enable"}
          </Button>
        )}
      </div>
      {isDenied && (
        <p className="text-xs text-muted-foreground">
          Notifications are blocked by your browser. To enable them, go to your
          browser settings and allow notifications for this site.
        </p>
      )}
      {iosPwa && (
        <p className="text-xs text-muted-foreground">
          To receive notifications on iPhone, add Kurir to your Home Screen
          first: tap <strong>Share</strong> then{" "}
          <strong>Add to Home Screen</strong>, then enable notifications from
          there.
        </p>
      )}
    </div>
  );
}
