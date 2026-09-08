import webpush from "web-push";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import {
  apnsConfigured,
  sendApnsBackground,
  sendApnsNotification,
  type ApnsSendResult,
} from "@/lib/push/apns";
import {
  relayConfigured,
  sendRelayBackground,
  sendRelayNotification,
} from "@/lib/push/relay";
import { getImboxUnreadThreadCount } from "@/lib/mail/unread-count";

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

type IosSend<T> = (
  deviceToken: string,
  payload: T,
  opts?: { sandbox?: boolean },
) => Promise<ApnsSendResult>;

/**
 * Send to one APNs token, learning which gateway it belongs to. Dev (Xcode)
 * builds carry sandbox tokens while TestFlight/App Store builds carry
 * production tokens, and the same phone flips between them on reinstall — so
 * BadDeviceToken from one gateway is retried against the other before the
 * token is declared dead. `workedEnv` is the gateway that accepted the token
 * (for persisting on the subscription), null when nothing did.
 */
export async function sendIosWithEnvFallback<T>(
  send: IosSend<T>,
  deviceToken: string,
  payload: T,
  knownEnv: string | null,
  defaultSandbox: boolean,
): Promise<{
  result: ApnsSendResult;
  workedEnv: "sandbox" | "production" | null;
}> {
  const firstSandbox =
    knownEnv !== null ? knownEnv === "sandbox" : defaultSandbox;
  const first = await send(deviceToken, payload, { sandbox: firstSandbox });
  if (first.ok) {
    return { result: first, workedEnv: firstSandbox ? "sandbox" : "production" };
  }
  if (!first.gone) return { result: first, workedEnv: null };

  const second = await send(deviceToken, payload, { sandbox: !firstSandbox });
  if (second.ok) {
    return {
      result: second,
      workedEnv: firstSandbox ? "production" : "sandbox",
    };
  }
  return { result: second, workedEnv: null };
}

export async function pushToUser(userId: string, payload: PushPayload) {
  ensureVapid();
  const webConfigured = getConfig().vapid.configured;
  if (!webConfigured && !apnsConfigured() && !relayConfigured()) return;

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
      apnsEnv: true,
    },
  });

  if (subscriptions.length === 0) return;

  const hasIos = subscriptions.some((s) => s.platform === "ios");
  const badge = hasIos
    ? await getImboxUnreadThreadCount(userId)
        .then((n) => Math.min(n, 99_999))
        .catch(() => undefined)
    : undefined;

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
        // VAPID alone gets us here - without APNs keys or a relay there is
        // no iOS gateway, so say so instead of fetching "undefined/api/push".
        if (!apnsConfigured() && !relayConfigured()) {
          console.warn(
            "[push] iOS push not configured - set APNS_* keys or PUSH_RELAY_URL",
          );
          return;
        }
        const deviceToken = sub.endpoint.replace(/^apns:/, "");
        // Direct APNs wins when both are configured — the maintainer's own
        // instance must not loop through the relay.
        const sendIos: IosSend = apnsConfigured()
          ? sendApnsNotification
          : sendRelayNotification;
        const { result, workedEnv } = await sendIosWithEnvFallback(
          sendIos,
          deviceToken,
          { ...payload, tag: safeTopic, ...(badge !== undefined ? { badge } : {}) },
          sub.apnsEnv,
          process.env.APNS_SANDBOX === "true",
        );
        if (workedEnv && workedEnv !== sub.apnsEnv) {
          await db.pushSubscription
            .update({ where: { id: sub.id }, data: { apnsEnv: workedEnv } })
            .catch(() => {});
        }
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

const NUDGE_DEBOUNCE_MS = 500;
const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Wake native clients so they can drop lock-screen banners for mail that
 * was just marked read. Trailing-debounce per user: a burst of reads
 * (bulk, thread open) becomes one silent push after the last write.
 */
export function nudgeIosClients(userId: string): void {
  const existing = pendingNudges.get(userId);
  if (existing) clearTimeout(existing);
  pendingNudges.set(
    userId,
    setTimeout(() => {
      pendingNudges.delete(userId);
      void sendIosNudge(userId);
    }, NUDGE_DEBOUNCE_MS),
  );
}

async function sendIosNudge(userId: string) {
  if (!apnsConfigured() && !relayConfigured()) return;

  let subscriptions: {
    id: string;
    endpoint: string;
    apnsEnv: string | null;
  }[];
  try {
    subscriptions = await db.pushSubscription.findMany({
      where: { userId, platform: "ios" },
      select: {
        id: true,
        endpoint: true,
        apnsEnv: true,
      },
    });
  } catch (err) {
    console.error("[push] Nudge lookup failed:", err);
    return;
  }
  if (subscriptions.length === 0) return;

  const sendIos = apnsConfigured() ? sendApnsBackground : sendRelayBackground;

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const deviceToken = sub.endpoint.replace(/^apns:/, "");
      const { result, workedEnv } = await sendIosWithEnvFallback(
        sendIos,
        deviceToken,
        {},
        sub.apnsEnv,
        process.env.APNS_SANDBOX === "true",
      );
      if (workedEnv && workedEnv !== sub.apnsEnv) {
        await db.pushSubscription
          .update({ where: { id: sub.id }, data: { apnsEnv: workedEnv } })
          .catch(() => {});
      }
      if (result.gone) {
        await db.pushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => {});
        console.log(`[push] Removed dead APNs token ${sub.id}`);
      }
      if (!result.ok) {
        throw new Error(`APNs ${result.status ?? ""} ${result.reason ?? ""}`);
      }
    }),
  );

  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) {
    if (f.status === "rejected") {
      console.error(`[push] Nudge failure:`, f.reason?.message || f.reason);
    }
  }
}
