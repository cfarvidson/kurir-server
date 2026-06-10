import { ImapFlow, MailboxLockObject } from "imapflow";
import { getConnectionCredentialsInternal } from "@/lib/auth";
import { db } from "@/lib/db";
import { sseSubscribers } from "./sse-subscribers";
import { buildImapAuth } from "@/lib/mail/auth-helpers";

// Single-process constraint: ConnectionManager, sseSubscribers, and echo
// suppression must all live in the same Node.js process. See plan doc for details.

export interface EmailConnectionConn {
  connectionId: string;
  userId: string;
  client: ImapFlow;
  folderId: string;
  lock: MailboxLockObject | null;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  debounceTimers: Map<string, NodeJS.Timeout>;
  /** Consecutive sync-lock-deferred new-message retries (see idle-handlers). */
  newMessageRetryAttempts: number;
  /** Coalescing guard: a new-message check is currently running. */
  newMessageCheckInFlight: boolean;
  isGmail: boolean;
  lastActivity: Date;
}

const BACKOFF_SCHEDULE = [0, 5_000, 15_000, 30_000, 60_000, 300_000]; // max 5 min
const MAX_IDLE_CONNECTIONS = 25;

/**
 * Options for {@link ConnectionManager.startConnection}.
 *
 * `evictOnCap` (default `true`) preserves the lazy-start behavior: when the
 * 25-connection cap is reached, evict the least-recently-active inactive
 * connection to make room. Boot-time start (U5) passes `false`: at boot
 * `sseSubscribers` is empty so *everyone* is evictable, and evicting to admit
 * each connection past the cap would thrash (each start kicks out a
 * just-started one). With `evictOnCap: false` a start that hits the cap is
 * skipped instead — the boot enumeration stops at the cap on its own.
 */
export interface StartConnectionOptions {
  evictOnCap?: boolean;
}

class ConnectionManager {
  // Keyed by emailConnectionId
  private connections = new Map<string, EmailConnectionConn>();
  private pendingReconnects = new Map<string, NodeJS.Timeout>();
  // Consecutive failed/interrupted start attempts since the last successful
  // connect. Lives outside the conn object so the backoff survives the
  // delete-and-recreate cycle of a failing startConnection — otherwise every
  // retry reads attempt 0 and the schedule never advances past its 0ms slot.
  private reconnectAttempts = new Map<string, number>();
  // Synchronous reservation for in-progress starts. The `connections.has`
  // guard alone spans several awaits before the conn is inserted, so two
  // concurrent callers (boot-start racing the sync job's lazy start) would
  // both pass it and create two ImapFlow clients — one leaks.
  private starting = new Set<string>();
  private stopping = false;

  get activeCount(): number {
    return this.connections.size;
  }

  get maxConnections(): number {
    return MAX_IDLE_CONNECTIONS;
  }

  async startConnection(
    connectionId: string,
    options: StartConnectionOptions = {},
  ): Promise<void> {
    if (this.connections.has(connectionId) || this.stopping) return;
    // Reserve synchronously before the first await — concurrent callers
    // (boot-start vs the sync job's lazy start) must not both proceed.
    if (this.starting.has(connectionId)) return;
    this.starting.add(connectionId);
    try {
      await this.doStartConnection(connectionId, options);
    } finally {
      this.starting.delete(connectionId);
    }
  }

  private async doStartConnection(
    connectionId: string,
    options: StartConnectionOptions,
  ): Promise<void> {
    const { evictOnCap = true } = options;

    // Enforce connection cap.
    if (this.connections.size >= MAX_IDLE_CONNECTIONS) {
      if (!evictOnCap) {
        // Boot-start: never evict — skip and let the enumeration stop.
        console.log(
          `[idle] Cap reached (${MAX_IDLE_CONNECTIONS}), skipping ${connectionId} (no-evict)`,
        );
        return;
      }
      // Lazy start: evict least-recently-active inactive connection.
      const evicted = this.findEvictionCandidate();
      if (evicted) {
        console.log(
          `[idle] Cap reached (${MAX_IDLE_CONNECTIONS}), evicting ${evicted}`,
        );
        await this.stopConnection(evicted);
      } else {
        // All connections belong to active users — skip this one
        console.log(
          `[idle] Cap reached, all connections active, skipping ${connectionId}`,
        );
        return;
      }
    }

    const credentials = await getConnectionCredentialsInternal(connectionId);
    if (!credentials) {
      console.error("[idle] No credentials for connection", connectionId);
      return;
    }

    // Look up userId and INBOX folder for this email connection
    const emailConn = await db.emailConnection.findUnique({
      where: { id: connectionId },
      select: { userId: true },
    });
    if (!emailConn) {
      console.error("[idle] EmailConnection not found", connectionId);
      return;
    }

    const inboxFolder = await db.folder.findFirst({
      where: { emailConnectionId: connectionId, specialUse: "inbox" },
      select: { id: true },
    });

    if (!inboxFolder) {
      console.warn("[idle] No INBOX folder found for connection", connectionId);
      return;
    }

    const isGmail = credentials.imap.host.includes("gmail.com");

    const client = new ImapFlow({
      host: credentials.imap.host,
      port: credentials.imap.port,
      secure: true,
      auth: buildImapAuth(credentials),
      logger: false,
      qresync: true,
    });

    const conn: EmailConnectionConn = {
      connectionId,
      userId: emailConn.userId,
      client,
      folderId: inboxFolder.id,
      lock: null,
      reconnectTimer: null,
      reconnectAttempt: this.reconnectAttempts.get(connectionId) ?? 0,
      debounceTimers: new Map(),
      newMessageRetryAttempts: 0,
      newMessageCheckInFlight: false,
      isGmail,
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, conn);

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      conn.lock = lock;

      // Import and register IDLE event handlers
      const { registerIdleHandlers, catchUpAfterReconnect, catchUpNewMessages } =
        await import("./idle-handlers");
      registerIdleHandlers(conn);

      // CONDSTORE catch-up: fetch flag changes missed during disconnection
      if (conn.reconnectAttempt > 0) {
        await catchUpAfterReconnect(client, connectionId, conn.folderId);
      }

      // New-mail catch-up: ingest INBOX mail that arrived while we had no IDLE
      // connection (server downtime / a disconnection gap). Bounded — defers a
      // cold folder or a large backlog to the sync job (see catchUpNewMessages).
      await catchUpNewMessages(connectionId);

      conn.reconnectAttempt = 0;
      this.reconnectAttempts.delete(connectionId);

      client.on("close", () => {
        if (!this.stopping) {
          this.scheduleReconnect(connectionId);
        }
      });

      console.log(
        `[idle] Started IDLE for connection ${connectionId}${isGmail ? " (Gmail)" : ""}`,
      );
    } catch (err) {
      console.error("[idle] Failed to start for connection", connectionId, err);
      // The client may have connected (and taken the INBOX lock) before the
      // failure — clean it up or the socket and mailbox lock leak.
      this.cleanupConnection(conn);
      this.connections.delete(connectionId);
      this.scheduleReconnect(connectionId);
    }
  }

  private scheduleReconnect(connectionId: string) {
    const conn = this.connections.get(connectionId);
    const attempt =
      conn?.reconnectAttempt ?? this.reconnectAttempts.get(connectionId) ?? 0;
    const delay =
      BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)];

    // Clean up old connection
    if (conn) {
      this.cleanupConnection(conn);
      this.connections.delete(connectionId);
    }

    if (this.stopping) return;

    console.log(
      `[idle] Reconnecting connection ${connectionId} in ${delay}ms (attempt ${attempt + 1})`,
    );

    const timer = setTimeout(async () => {
      this.pendingReconnects.delete(connectionId);
      // Persist the attempt count before starting: a failed start deletes the
      // conn object, so this map is what keeps the backoff advancing.
      this.reconnectAttempts.set(connectionId, attempt + 1);
      await this.startConnection(connectionId);
    }, delay);

    // Track timer on a separate map so it can be cancelled even if the
    // connection object was already removed from this.connections.
    this.pendingReconnects.set(connectionId, timer);
  }

  private cleanupConnection(conn: EmailConnectionConn) {
    // Clear all debounce timers
    for (const timer of conn.debounceTimers.values()) {
      clearTimeout(timer);
    }
    conn.debounceTimers.clear();

    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }

    if (conn.lock) {
      try {
        conn.lock.release();
      } catch {
        /* ignore */
      }
      conn.lock = null;
    }

    try {
      conn.client.close();
    } catch {
      /* ignore */
    }
  }

  /**
   * Find the best connection to evict: inactive user (no SSE) with oldest lastActivity.
   * Returns null if all connections belong to active SSE users.
   */
  private findEvictionCandidate(): string | null {
    let oldest: { connectionId: string; lastActivity: Date } | null = null;

    for (const conn of this.connections.values()) {
      // Only evict connections of users without active SSE
      if (sseSubscribers.has(conn.userId)) continue;

      if (!oldest || conn.lastActivity < oldest.lastActivity) {
        oldest = {
          connectionId: conn.connectionId,
          lastActivity: conn.lastActivity,
        };
      }
    }

    return oldest?.connectionId ?? null;
  }

  /** Update lastActivity timestamp for a connection (called on IDLE events). */
  touchActivity(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) conn.lastActivity = new Date();
  }

  async stopConnection(connectionId: string): Promise<void> {
    // Cancel any pending reconnect timer (may exist even without a connection)
    const pendingTimer = this.pendingReconnects.get(connectionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingReconnects.delete(connectionId);
    }

    // A deliberate stop also resets the failure backoff — a later start should
    // begin from a clean slate, not inherit a stale attempt count.
    this.reconnectAttempts.delete(connectionId);

    const conn = this.connections.get(connectionId);
    if (!conn) return;

    this.cleanupConnection(conn);
    this.connections.delete(connectionId);

    try {
      await conn.client.logout();
    } catch {
      /* ignore */
    }

    console.log(`[idle] Stopped IDLE for connection ${connectionId}`);
  }

  async stopAll(): Promise<void> {
    this.stopping = true;

    // Cancel all pending reconnect timers
    for (const [id, timer] of this.pendingReconnects) {
      clearTimeout(timer);
      this.pendingReconnects.delete(id);
    }

    const promises = Array.from(this.connections.keys()).map((id) =>
      this.stopConnection(id),
    );
    await Promise.allSettled(promises);
    console.log("[idle] All connections stopped");
  }

  getClient(connectionId: string): ImapFlow | null {
    return this.connections.get(connectionId)?.client ?? null;
  }

  getConnection(connectionId: string): EmailConnectionConn | undefined {
    return this.connections.get(connectionId);
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  // Start IDLE for all email connections belonging to a user
  async startAllForUser(userId: string): Promise<void> {
    const emailConns = await db.emailConnection.findMany({
      where: { userId },
      select: { id: true },
    });
    await Promise.allSettled(
      emailConns.map((ec) => this.startConnection(ec.id)),
    );
  }

  // Stop IDLE for all email connections belonging to a user
  async stopAllForUser(userId: string): Promise<void> {
    const toStop = Array.from(this.connections.values())
      .filter((c) => c.userId === userId)
      .map((c) => c.connectionId);
    await Promise.allSettled(toStop.map((id) => this.stopConnection(id)));
  }
}

// globalThis singleton — survives Next.js dev HMR
const globalForImap = globalThis as unknown as {
  connectionManager: ConnectionManager | undefined;
};

export const connectionManager =
  globalForImap.connectionManager ?? new ConnectionManager();

if (process.env.NODE_ENV !== "production") {
  globalForImap.connectionManager = connectionManager;
}

// Graceful shutdown is handled by stopBackgroundSync() in instrumentation.ts
