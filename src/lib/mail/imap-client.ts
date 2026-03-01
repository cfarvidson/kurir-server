import { ImapFlow } from "imapflow";
import { getConnectionCredentials } from "@/lib/auth";

/**
 * Runs a callback with an authenticated ImapFlow connection.
 * Handles credential lookup, connection, and guaranteed logout.
 * Returns null on IMAP failure (DB updates should still proceed).
 */
export async function withImapConnection<T>(
  connectionId: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T | null> {
  const credentials = await getConnectionCredentials(connectionId);
  if (!credentials) return null;

  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
    logger: false,
  });

  try {
    await client.connect();
    return await fn(client);
  } catch (err) {
    console.error("[imap] Connection error:", err);
    return null;
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors
    }
  }
}
