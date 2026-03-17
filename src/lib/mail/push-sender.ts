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

export async function pushToUser(userId: string, payload: PushPayload) {
  console.log(`[push] pushToUser called, vapidConfigured=${vapidConfigured}`);
  if (!vapidConfigured) return;

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  console.log(`[push] Found ${subscriptions.length} subscriptions for user`);
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
  console.log(
    `[push] Results: ${sent} sent, ${failed.length} failed out of ${subscriptions.length}`,
  );
  for (const f of failed) {
    if (f.status === "rejected") {
      console.error(`[push] Failure:`, f.reason?.message || f.reason);
    }
  }
}
