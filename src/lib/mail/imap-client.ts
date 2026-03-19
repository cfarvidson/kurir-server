import { ImapFlow, type ListResponse } from "imapflow";
import { getConnectionCredentialsInternal } from "@/lib/auth";

/**
 * Runs a callback with an authenticated ImapFlow connection.
 * Handles credential lookup, connection, and guaranteed logout.
 * Returns null on IMAP failure (DB updates should still proceed).
 */
export async function withImapConnection<T>(
  connectionId: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T | null> {
  const credentials = await getConnectionCredentialsInternal(connectionId);
  if (!credentials) {
    console.warn("[imap] No credentials found for connection:", connectionId);
    return null;
  }

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

/**
 * Find the archive mailbox from a list of IMAP mailboxes.
 * Prefers \Archive or "archive" path, falls back to \All.
 */
export function findArchiveMailbox(
  mailboxes: ListResponse[],
): ListResponse | undefined {
  return (
    mailboxes.find(
      (mb) =>
        mb.specialUse === "\\Archive" ||
        mb.path.toLowerCase() === "archive",
    ) ?? mailboxes.find((mb) => mb.specialUse === "\\All")
  );
}
