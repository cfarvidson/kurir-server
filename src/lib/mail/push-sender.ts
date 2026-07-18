import webpush from "web-push";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { apnsConfigured, sendApnsNotification } from "@/lib/push/apns";

let vapidInitialized = false;
function ensureVapid() {
  if (vapidInitialized) return;
  vapidInitialized = true;
  const { vapid, adminEmail } = getConfig();
  if (vapid.configured) {
    webpush.setVapidDetails(
      adminEmail ? `mailto:${adminEmail}` : "mailto:admin@kurir.app",
      vapid.publicKey!,
      vapid.privateKey!,
    );
  } else {
    console.warn(
      "[push] VAPID keys not configured — push notifications disabled",
    );
  }
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

// Dedup: track recently notified message URLs to prevent IDLE + bg-sync double-push
const recentlyNotified = new Set<string>();
const DEDUP_TTL_MS = 120_000; // 2 minutes

export async function pushToUser(userId: string, payload: PushPayload) {
  ensureVapid();
  const webConfigured = getConfig().vapid.configured;
  if (!webConfigured && !apnsConfigured()) return;

  // Dedup by URL (contains the message ID)
  const dedupeKey = `${userId}:${payload.url}`;
  if (recentlyNotified.has(dedupeKey)) return;
  recentlyNotified.add(dedupeKey);
  setTimeout(() => recentlyNotified.delete(dedupeKey), DEDUP_TTL_MS);

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: {
      id: true,
      platform: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  // topic must be max 32 chars, URL-safe (no angle brackets from Message-IDs)
  const safeTopic = payload.tag?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);

  const options = {
    TTL: 3600,
    urgency: "high" as const,
    ...(safeTopic ? { topic: safeTopic } : {}),
  };

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      // iOS rows store the APNs device token as "apns:<token>"
      if (sub.platform === "ios") {
        const deviceToken = sub.endpoint.replace(/^apns:/, "");
        const result = await sendApnsNotification(deviceToken, {
          ...payload,
          tag: safeTopic,
        });
        if (result.gone) {
          await db.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
          console.log(`[push] Removed dead APNs token ${sub.id}`);
        }
        if (!result.ok) {
          throw new Error(`APNs ${result.status ?? ""} ${result.reason ?? ""}`);
        }
        return;
      }

      if (!webConfigured) return;
      await webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          options,
        )
        .catch(async (err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => {});
            console.log(`[push] Removed expired subscription ${sub.id}`);
          }
          throw err;
        });
    }),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");
  if (sent > 0) {
    console.log(
      `[push] Sent ${sent}/${subscriptions.length} for "${payload.title}"`,
    );
  }
  for (const f of failed) {
    if (f.status === "rejected") {
      console.error(`[push] Failure:`, f.reason?.message || f.reason);
    }
  }
}
