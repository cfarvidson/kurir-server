import { ImapFlow, MailboxLockObject } from "imapflow";
import { getUserCredentials } from "@/lib/auth";
import { db } from "@/lib/db";

// Single-process constraint: ConnectionManager, sseSubscribers, and echo
// suppression must all live in the same Node.js process. See plan doc for details.

export interface UserConnection {
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
  private connections = new Map<string, UserConnection>();
  private stopping = false;

  async startUser(userId: string): Promise<void> {
    if (this.connections.has(userId) || this.stopping) return;

    const credentials = await getUserCredentials(userId);
    if (!credentials) {
      console.error("[idle] No credentials for user", userId);
      return;
    }

    // Find INBOX folder ID
    const inboxFolder = await db.folder.findFirst({
      where: { userId, specialUse: "inbox" },
      select: { id: true },
    });

    if (!inboxFolder) {
      console.warn("[idle] No INBOX folder found for user", userId);
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

    const conn: UserConnection = {
      userId,
      client,
      folderId: inboxFolder.id,
      lock: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
      debounceTimers: new Map(),
      isGmail,
    };

    this.connections.set(userId, conn);

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      conn.lock = lock;
      conn.reconnectAttempt = 0;

      // Import and register IDLE event handlers
      const { registerIdleHandlers, catchUpAfterReconnect } = await import("./idle-handlers");
      registerIdleHandlers(conn);

      // CONDSTORE catch-up: fetch flag changes missed during disconnection
      if (conn.reconnectAttempt > 0) {
        await catchUpAfterReconnect(client, userId, conn.folderId);
      }

      client.on("close", () => {
        if (!this.stopping) {
          this.scheduleReconnect(userId);
        }
      });

      console.log(`[idle] Started IDLE for user ${userId}${isGmail ? " (Gmail)" : ""}`);
    } catch (err) {
      console.error("[idle] Failed to start for user", userId, err);
      this.connections.delete(userId);
      this.scheduleReconnect(userId);
    }
  }

  private scheduleReconnect(userId: string) {
    const conn = this.connections.get(userId);
    const attempt = conn?.reconnectAttempt ?? 0;
    const delay = BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)];

    // Clean up old connection
    if (conn) {
      this.cleanupConnection(conn);
      this.connections.delete(userId);
    }

    if (this.stopping) return;

    console.log(`[idle] Reconnecting user ${userId} in ${delay}ms (attempt ${attempt + 1})`);

    const timer = setTimeout(async () => {
      // Store attempt count before the old conn is gone
      const nextAttempt = attempt + 1;
      await this.startUser(userId);
      const newConn = this.connections.get(userId);
      if (newConn) {
        newConn.reconnectAttempt = nextAttempt;
      }
    }, delay);

    // Track timer so stopUser can clear it
    if (conn) {
      conn.reconnectTimer = timer;
    }
  }

  private cleanupConnection(conn: UserConnection) {
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

  async stopUser(userId: string): Promise<void> {
    const conn = this.connections.get(userId);
    if (!conn) return;

    this.cleanupConnection(conn);
    this.connections.delete(userId);

    try {
      await conn.client.logout();
    } catch { /* ignore */ }

    console.log(`[idle] Stopped IDLE for user ${userId}`);
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    const promises = Array.from(this.connections.keys()).map((id) =>
      this.stopUser(id)
    );
    await Promise.allSettled(promises);
    console.log("[idle] All connections stopped");
  }

  getClient(userId: string): ImapFlow | null {
    return this.connections.get(userId)?.client ?? null;
  }

  getConnection(userId: string): UserConnection | undefined {
    return this.connections.get(userId);
  }

  isConnected(userId: string): boolean {
    return this.connections.has(userId);
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
