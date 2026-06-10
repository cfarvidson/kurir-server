"use client";

import { useState, useEffect, useCallback } from "react";

export function base64UrlToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const PUSH_NOT_CONFIGURED = "Push notifications are not configured on this server";

async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/push/vapid-public-key");
  if (!res.ok) {
    throw new Error(PUSH_NOT_CONFIGURED);
  }
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) {
    throw new Error(PUSH_NOT_CONFIGURED);
  }
  // Reject a corrupted key here so the caller surfaces the friendly message
  // instead of a raw DOMException from atob() deep inside subscribe().
  try {
    base64UrlToUint8Array(publicKey);
  } catch {
    throw new Error(PUSH_NOT_CONFIGURED);
  }
  return publicKey;
}

export function usePushNotifications() {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  // null = unknown (probe in flight); true/false = confirmed by the server.
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    setIsSupported(supported);
    if (supported) {
      setPermission(Notification.permission);
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setIsSubscribed(!!sub)),
      );
      // Probe whether the server has VAPID configured so the UI can show an
      // honest "not configured" state instead of a dead Enable button. A
      // network blip leaves isConfigured null (unknown) rather than falsely
      // marking the server unconfigured for the whole session.
      fetch("/api/push/vapid-public-key")
        .then((res) => setIsConfigured(res.ok))
        .catch(() => {});
    }
  }, []);

  const subscribe = useCallback(async () => {
    // The public key is read at runtime (it may be auto-generated on the
    // server), so it must be fetched rather than inlined at build time.
    const publicKey = await fetchVapidPublicKey();

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });

    const json = sub.toJSON();
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      }),
    });

    if (!res.ok) {
      await sub.unsubscribe();
      throw new Error("Failed to save push subscription");
    }

    setPermission(Notification.permission);
    setIsSubscribed(true);
  }, []);

  const unsubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setIsSubscribed(false);
  }, []);

  return {
    isSupported,
    isConfigured,
    permission,
    isSubscribed,
    subscribe,
    unsubscribe,
  };
}

export function isIosNonPwa(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    "standalone" in navigator &&
    (navigator as { standalone?: boolean }).standalone;
  return isIos && !isStandalone;
}
