/**
 * Curated list of known email tracker / spy-pixel domains.
 *
 * This is the high-precision backbone of the "block trackers" mode (the generic
 * tiny/invisible-pixel heuristic in {@link "./tracker-detection"} catches the
 * long tail). It is intentionally CURATED and small rather than exhaustive:
 * every entry is a domain whose images are overwhelmingly open/read tracking,
 * so a host-suffix match alone is a safe signal. Entries that also serve
 * legitimate hosted images carry explicit `paths` so only the tracking endpoint
 * is stripped.
 *
 * Sources: HEY's published spy-pixel list (DHH), the disconnect.me "Email"
 * tracker-protection category, and the simplify-trackers ESP path patterns.
 * To refresh: cross-check those lists and add dedicated-tracker domains here.
 * Prefer adding a domain only when it is tracking-dedicated, or add a `paths`
 * qualifier when the host also serves real images.
 */

export interface TrackerDomainEntry {
  /** Registrable host or any subdomain of it (matched on a dot boundary). */
  host: string;
  /**
   * Optional path fragments. When present, the URL is only treated as a tracker
   * if its pathname contains one of these (case-insensitive). Use for hosts that
   * also serve legitimate images so we don't strip those.
   */
  paths?: string[];
}

export const TRACKER_DOMAINS: TrackerDomainEntry[] = [
  // --- Dedicated open/click-tracking domains (host match is sufficient) ---
  { host: "emltrk.com" }, // Litmus email analytics pixel
  { host: "pstmrk.it" }, // Postmark open tracking
  { host: "sendgrid.net", paths: ["/wf/open", "/wf/click", "/ls/click"] },
  { host: "rs6.net" }, // Constant Contact open tracking
  { host: "bananatag.com" },
  { host: "btn0.com" }, // Bananatag pixel host
  { host: "toutapp.com" },
  { host: "yesware.com" },
  { host: "t.yesware.com" },
  { host: "mixmax.com", paths: ["/api/track", "/e/o/"] },
  { host: "streak.com", paths: ["/burst", "/api/v1/track"] },
  { host: "mailtrack.io" },
  { host: "mailfoogae.appspot.com" }, // MailTracker (Mailfoogae)
  { host: "did.bz" }, // DidTheyReadIt
  { host: "open.convertkit-mail.com" },
  { host: "trk.klaviyomail.com" },
  { host: "ctrack.klaviyo.com" },
  { host: "mandrillapp.com", paths: ["/track"] },
  { host: "list-manage.com", paths: ["/track/open", "/track/click"] }, // Mailchimp
  { host: "mailchimpapp.net", paths: ["/track"] },
  { host: "mktoresp.com" }, // Marketo
  { host: "pardot.com", paths: ["/l/", "/open", "/vu/"] },
  { host: "exct.net", paths: ["/open", "/click"] }, // Salesforce Marketing Cloud
  { host: "exacttarget.com", paths: ["/open", "/click"] },
  { host: "sailthru.com", paths: ["/track", "/open"] },
  { host: "sparkpostmail.com", paths: ["/f/open", "/f/a/"] },
  { host: "mailgun.org", paths: ["/o/", "/track"] },
  { host: "mailgun.net", paths: ["/o/", "/track"] },
  { host: "mjt.lu" }, // Mailjet tracking shortener
  { host: "mailjet.com", paths: ["/oo/", "/statistics/"] },
  { host: "acemlna.com" }, // ActiveCampaign
  { host: "activehosted.com", paths: ["/open", "/p/", "/lt.php"] },
  { host: "getdrip.com", paths: ["/o/", "/open"] },
  { host: "bm23.com" }, // Bronto
  { host: "emarsys.net", paths: ["/e/", "/u/open"] },
  { host: "rsys.net", paths: ["/pub/", "/open"] }, // Oracle Responsys
  { host: "hubspotemail.net", paths: ["/e2t/o/", "/hs/"] },
  { host: "hubspotlinks.com" },
  { host: "customeriomail.com", paths: ["/t/", "/e/o/"] },
  { host: "track.customer.io" },
  { host: "iterable.com", paths: ["/a/", "/u/open"] },
  { host: "links.iterable.com" },
  { host: "braze.com", paths: ["/api/v3/messages", "/openTracking"] },
  { host: "cheetahmail.com" },
  { host: "boomerangapp.com", paths: ["/track"] },
  { host: "gmass.co", paths: ["/open", "/track"] },
  { host: "intelliclick.com" },
  { host: "contactmonkey.com" },
  { host: "saleshandy.com", paths: ["/track"] },
  { host: "newton-mail.com", paths: ["/track"] },
];
