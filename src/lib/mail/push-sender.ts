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
  console.warn("[push] VAPID keys not configured — push notifications disabled");
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export async function pushToUser(userId: string, payload: PushPayload) {
  if (!vapidConfigured) return;

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  const options = {
    TTL: 3600,
    urgency: "high" as const,
    topic: payload.tag,
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
  if (sent > 0) {
    console.log(
      `[push] Sent ${sent}/${subscriptions.length} notifications to user ${userId}`,
    );
  }
}
