/** Default manifest URL — overridable via SystemSettings.updateManifestUrl */
export const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/cfarvidson/kurir-server/main/latest.json";

/** How often to check for updates (ms) — 6 hours */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How long to wait for health check after restart (ms) */
export const HEALTH_CHECK_TIMEOUT_MS = 60_000;

/** Health check poll interval (ms) */
export const HEALTH_CHECK_INTERVAL_MS = 5_000;
