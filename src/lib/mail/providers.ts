export interface EmailProvider {
  id: string;
  name: string;
  domain: string | null;
  oauthKey?: "microsoft" | "google";
  imap?: { host: string; port: number };
  smtp?: { host: string; port: number };
}

export const EMAIL_PROVIDERS: EmailProvider[] = [
  {
    id: "gmail",
    name: "Gmail",
    domain: "gmail.com",
    oauthKey: "google",
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 587 },
  },
  {
    id: "outlook",
    name: "Outlook / Hotmail",
    domain: "outlook.com",
    oauthKey: "microsoft",
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587 },
  },
  {
    id: "icloud",
    name: "iCloud",
    domain: "icloud.com",
    imap: { host: "imap.mail.me.com", port: 993 },
    smtp: { host: "smtp.mail.me.com", port: 587 },
  },
  {
    id: "yahoo",
    name: "Yahoo",
    domain: "yahoo.com",
    imap: { host: "imap.mail.yahoo.com", port: 993 },
    smtp: { host: "smtp.mail.yahoo.com", port: 465 },
  },
  { id: "custom", name: "Other / Custom", domain: null },
];

/**
 * Detect email provider from an email address domain.
 * Returns the provider id, or "custom" if no match.
 */
export function detectProviderFromEmail(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "gmail"; // default

  for (const p of EMAIL_PROVIDERS) {
    if (p.domain && (domain === p.domain || domain.endsWith("." + p.domain))) {
      return p.id;
    }
  }
  return "custom";
}
