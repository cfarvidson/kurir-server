import { REQUIRED_UPDATER_PROTOCOL } from "./constants";

export interface UpdaterHealth {
  /** UPDATER_TOKEN is set, i.e. this install has an updater sidecar at all. */
  configured: boolean;
  reachable: boolean;
  protocolVersion: number | null;
  /**
   * The sidecar answered but is too old to honor `imageRef` pinning /
   * verify the running version — updates through it are unsafe.
   */
  stale: boolean;
}

/**
 * Probe the updater sidecar's /health for its protocol version. Legacy
 * sidecars answer `{"ok": true}` without a protocolVersion — those predate
 * `imageRef` pinning and are reported as stale.
 */
export async function checkUpdaterHealth(): Promise<UpdaterHealth> {
  if (!process.env.UPDATER_TOKEN) {
    return {
      configured: false,
      reachable: false,
      protocolVersion: null,
      stale: false,
    };
  }

  const updaterUrl = process.env.UPDATER_URL ?? "http://updater:8080";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${updaterUrl}/health`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        protocolVersion: null,
        stale: false,
      };
    }
    const body = (await res.json().catch(() => ({}))) as {
      protocolVersion?: unknown;
    };
    const protocolVersion =
      typeof body.protocolVersion === "number" ? body.protocolVersion : null;
    return {
      configured: true,
      reachable: true,
      protocolVersion,
      stale: (protocolVersion ?? 0) < REQUIRED_UPDATER_PROTOCOL,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      protocolVersion: null,
      stale: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
