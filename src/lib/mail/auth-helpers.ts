/**
 * Build the correct auth object for ImapFlow or nodemailer,
 * depending on whether credentials are password-based or OAuth.
 */

export interface ConnectionCredentials {
  email: string;
  sendAsEmail: string | null;
  aliases: string[];
  password: string | null;
  accessToken: string | null;
  oauthProvider: string | null;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
}

/** ImapFlow auth: { user, pass } or { user, accessToken } */
export function buildImapAuth(creds: ConnectionCredentials) {
  if (creds.accessToken) {
    return { user: creds.email, accessToken: creds.accessToken };
  }
  return { user: creds.email, pass: creds.password! };
}

/** Nodemailer auth: { user, pass } or { type: "OAuth2", user, accessToken } */
export function buildSmtpAuth(creds: ConnectionCredentials) {
  if (creds.accessToken) {
    return {
      type: "OAuth2" as const,
      user: creds.email,
      accessToken: creds.accessToken,
    };
  }
  return { user: creds.email, pass: creds.password! };
}
