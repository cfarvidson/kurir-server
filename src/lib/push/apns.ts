import { createPrivateKey, createSign, randomUUID } from "crypto";
import { connect } from "http2";

/**
 * Minimal APNs client: token-based auth (.p8 / ES256) over HTTP/2.
 *
 * Env:
 *   APNS_KEY_P8    — contents of the .p8 key (literal, "\n" escapes allowed)
 *   APNS_KEY_ID    — key id from the developer portal
 *   APNS_TEAM_ID   — Apple team id
 *   APNS_BUNDLE_ID — the app's bundle id (apns-topic)
 *   APNS_SANDBOX   — "true" to use the sandbox gateway (dev builds)
 *
 * All unset → APNs is disabled and sendApnsNotification is a no-op that
 * reports `configured: false`.
 */

interface ApnsConfig {
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

function getApnsConfig(): ApnsConfig | null {
  const { APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID } =
    process.env;
  if (!APNS_KEY_P8 || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) {
    return null;
  }
  return {
    key: APNS_KEY_P8.replace(/\\n/g, "\n"),
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    bundleId: APNS_BUNDLE_ID,
    host:
      process.env.APNS_SANDBOX === "true"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
  };
}

export function apnsConfigured(): boolean {
  return getApnsConfig() !== null;
}

// Provider token is valid 20-60 min; refresh after 50.
let cachedToken: { token: string; issuedAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function providerToken(config: ApnsConfig): string {
  if (cachedToken && Date.now() - cachedToken.issuedAt < TOKEN_TTL_MS) {
    return cachedToken.token;
  }

  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: config.keyId }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: config.teamId,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signingInput = `${header}.${payload}`;

  const key = createPrivateKey(config.key);
  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });

  const token = `${signingInput}.${base64url(signature)}`;
  cachedToken = { token, issuedAt: Date.now() };
  return token;
}

export interface ApnsSendResult {
  ok: boolean;
  /** True when APNs said the token is dead (410/BadDeviceToken). */
  gone: boolean;
  status?: number;
  reason?: string;
}

/**
 * Send one alert notification to one device token.
 * Opens a fresh HTTP/2 session per call — fine at personal-server volume.
 */
export async function sendApnsNotification(
  deviceToken: string,
  payload: { title: string; body: string; url: string; tag?: string },
): Promise<ApnsSendResult> {
  const config = getApnsConfig();
  if (!config) {
    return { ok: false, gone: false, reason: "not configured" };
  }

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "thread-id": payload.tag ?? "kurir",
    },
    url: payload.url,
  });

  return new Promise((resolve) => {
    const session = connect(config.host);
    session.on("error", (err) => {
      resolve({ ok: false, gone: false, reason: String(err) });
    });

    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": payload.tag?.slice(0, 63) ?? undefined,
      "apns-id": randomUUID(),
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      session.close();
      if (status === 200) {
        resolve({ ok: true, gone: false, status });
        return;
      }
      let reason: string | undefined;
      try {
        reason = JSON.parse(responseBody).reason;
      } catch {
        reason = responseBody || undefined;
      }
      resolve({
        ok: false,
        gone: status === 410 || reason === "BadDeviceToken",
        status,
        reason,
      });
    });
    req.on("error", (err) => {
      session.close();
      resolve({ ok: false, gone: false, reason: String(err) });
    });

    req.end(body);
  });
}
