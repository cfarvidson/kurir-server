/**
 * Demo-instance detection (App Store review / public demo).
 *
 * When both DEMO_LOGIN_* vars are set the instance serves seeded,
 * entirely fictional mail: IMAP/SMTP hosts do not exist, so all sync and
 * send activity is disabled at the source instead of surfacing
 * connection errors to the reviewer.
 */
export function isDemoInstance(): boolean {
  return Boolean(
    process.env.DEMO_LOGIN_EMAIL && process.env.DEMO_LOGIN_PASSWORD,
  );
}
