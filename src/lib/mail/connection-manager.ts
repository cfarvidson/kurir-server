import { ImapFlow, MailboxLockObject } from "imapflow";
import { getConnectionCredentials } from "@/lib/auth";
import { db } from "@/lib/db";

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
  isGmail: boolean;
}

const BACKOFF_SCHEDULE = [0, 5_000, 15_000, 30_000, 60_000, 300_000]; // max 5 min

class ConnectionManager {
  // Keyed by emailConnectionId
  private connections = new Map<string, EmailConnectionConn>();
  private pendingReconnects = new Map<string, NodeJS.Timeout>();
  private stopping = false;

  async startConnection(connectionId: string): Promise<void> {
    if (this.connections.has(connectionId) || this.stopping) return;

    const credentials = await getConnectionCredentials(connectionId);
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
      auth: { user: credentials.email, pass: credentials.password },
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
      reconnectAttempt: 0,
      debounceTimers: new Map(),
      isGmail,
    };

    this.connections.set(connectionId, conn);

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      conn.lock = lock;

      // Import and register IDLE event handlers
      const { registerIdleHandlers, catchUpAfterReconnect } = await import("./idle-handlers");
      registerIdleHandlers(conn);

      // CONDSTORE catch-up: fetch flag changes missed during disconnection
      if (conn.reconnectAttempt > 0) {
        await catchUpAfterReconnect(client, connectionId, conn.folderId);
      }

      conn.reconnectAttempt = 0;

      client.on("close", () => {
        if (!this.stopping) {
          this.scheduleReconnect(connectionId);
        }
      });

      console.log(`[idle] Started IDLE for connection ${connectionId}${isGmail ? " (Gmail)" : ""}`);
    } catch (err) {
      console.error("[idle] Failed to start for connection", connectionId, err);
      this.connections.delete(connectionId);
      this.scheduleReconnect(connectionId);
    }
  }

  private scheduleReconnect(connectionId: string) {
    const conn = this.connections.get(connectionId);
    const attempt = conn?.reconnectAttempt ?? 0;
    const delay = BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)];

    // Clean up old connection
    if (conn) {
      this.cleanupConnection(conn);
      this.connections.delete(connectionId);
    }

    if (this.stopping) return;

    console.log(`[idle] Reconnecting connection ${connectionId} in ${delay}ms (attempt ${attempt + 1})`);

    const timer = setTimeout(async () => {
      this.pendingReconnects.delete(connectionId);
      const nextAttempt = attempt + 1;
      await this.startConnection(connectionId);
      const newConn = this.connections.get(connectionId);
      if (newConn) {
        newConn.reconnectAttempt = nextAttempt;
      }
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
      try { conn.lock.release(); } catch { /* ignore */ }
      conn.lock = null;
    }

    try { conn.client.close(); } catch { /* ignore */ }
  }

  async stopConnection(connectionId: string): Promise<void> {
    // Cancel any pending reconnect timer (may exist even without a connection)
    const pendingTimer = this.pendingReconnects.get(connectionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingReconnects.delete(connectionId);
    }

    const conn = this.connections.get(connectionId);
    if (!conn) return;

    this.cleanupConnection(conn);
    this.connections.delete(connectionId);

    try {
      await conn.client.logout();
    } catch { /* ignore */ }

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
      this.stopConnection(id)
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
      emailConns.map((ec) => this.startConnection(ec.id))
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

// Graceful shutdown
process.on("SIGTERM", () => {
  connectionManager.stopAll().catch(console.error);
});
