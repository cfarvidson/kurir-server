import type { ApnsSendResult } from "./apns";

/**
 * APNs relay client for self-hosted instances without the .p8 key.
 * POSTs to a kurir-notify deployment (PUSH_RELAY_URL) which signs against
 * APNs and answers with the same result shape as sendApnsNotification.
 */

export function relayConfigured(): boolean {
  return !!process.env.PUSH_RELAY_URL;
}

export async function sendRelayNotification(
  deviceToken: string,
  payload: {
    title: string;
    body: string;
    url: string;
    tag?: string;
    badge?: number;
  },
  opts?: { sandbox?: boolean },
): Promise<ApnsSendResult> {
  const res = await fetch(`${process.env.PUSH_RELAY_URL}/api/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceToken,
      sandbox: opts?.sandbox ?? process.env.APNS_SANDBOX === "true",
      notification: payload,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, gone: false, reason: "relay unreachable" };
  if (!res.ok)
    return { ok: false, gone: false, status: res.status, reason: "relay error" };
  return (await res.json()) as ApnsSendResult;
}
