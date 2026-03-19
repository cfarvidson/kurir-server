import { ImapFlow } from "imapflow";

/**
 * Verify IMAP credentials by attempting to connect and disconnect
 */
export async function verifyImapCredentials(
  email: string,
  password: string,
  host: string,
  port: number
): Promise<boolean> {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (error) {
    console.error("IMAP verification failed:", error);
    return false;
  } finally {
    try { client.close(); } catch {}
  }
}
