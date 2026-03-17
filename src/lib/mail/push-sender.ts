import webpush from "web-push";
import { db } from "@/lib/db";

const vapidConfigured =
  !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

if (vapidConfigured) {
  webpush.setVapidDetails(
    "mailto:admin@kurir.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
} else {
  console.warn(
    "[push] VAPID keys not configured — push notifications disabled",
  );
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
  if (!vapidConfigured) return;

  // Dedup by URL (contains the message ID)
  const dedupeKey = `${userId}:${payload.url}`;
  if (recentlyNotified.has(dedupeKey)) return;
  recentlyNotified.add(dedupeKey);
  setTimeout(() => recentlyNotified.delete(dedupeKey), DEDUP_TTL_MS);

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
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
    subscriptions.map((sub) =>
      webpush
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
        }),
    ),
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
