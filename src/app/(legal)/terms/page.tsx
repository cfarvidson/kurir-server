import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use — Kurir",
};

export default function TermsPage() {
  return (
    <>
      <h1 className="font-serif text-title font-semibold tracking-tight">
        Terms of Use
      </h1>
      <p className="text-xs text-muted-foreground">Last updated: 2026-07-27</p>

      <h2 className="font-serif text-lead font-semibold">The app</h2>
      <p>
        Kurir is an email client for self-hosted Kurir servers. The app is
        provided <strong>as is</strong>, without warranty of any kind. The
        developer does not operate a mail service: the app connects to a
        server that you choose or host yourself, and the availability,
        behavior, and content of that server are outside the
        developer&rsquo;s control.
      </p>

      <h2 className="font-serif text-lead font-semibold">Acceptable use</h2>
      <p>
        You may not use the app to send spam or unlawful content, to attempt
        unauthorized access to servers you do not control, or to disrupt the
        push-notification relay. Your use of any mail server through the app
        is additionally governed by that server operator&rsquo;s own rules.
      </p>

      <h2 className="font-serif text-lead font-semibold">
        Limitation of liability
      </h2>
      <p>
        To the maximum extent permitted by law, the developer is not liable
        for any loss of data, loss of mail, missed notifications, or other
        damages arising from the use of, or inability to use, the app or the
        push-notification relay. Nothing in these terms limits rights you
        have under mandatory consumer-protection law.
      </p>

      <h2 className="font-serif text-lead font-semibold">Changes</h2>
      <p>
        These terms may be updated as the app evolves; the current version is
        always published on this page.
      </p>
    </>
  );
}
