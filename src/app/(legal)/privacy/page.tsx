import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Kurir",
};

/**
 * Written for the client + relay model: the developer runs no mail service.
 * The only processing the developer is responsible for is the stateless
 * push-notification relay transit (kurir-notify.arvidson.io). If the push
 * payload or relay behavior ever changes, this page AND the App Store
 * "Data Not Collected" privacy label must be rewritten together.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="font-serif text-title font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="text-xs text-muted-foreground">Last updated: 2026-07-27</p>

      <p>
        The Kurir app is a client for <strong>self-hosted</strong> Kurir mail
        servers. The developer, Carl-Fredrik Arvidson (
        <a
          href="mailto:carl-fredrik@arvidson.io"
          className="text-primary hover:underline"
        >
          carl-fredrik@arvidson.io
        </a>
        ), does not operate a mail service and does not host any user
        accounts. Your account, your email, and your attachments live on your
        device and on the server you choose or host yourself — a server the
        developer has no access to.
      </p>

      <h2 className="font-serif text-lead font-semibold">
        What passes through the developer&rsquo;s infrastructure
      </h2>
      <p>
        The only data that transits infrastructure operated by the developer
        is push notifications. When your server sends a notification, the
        sender&rsquo;s name and address, the subject line, your unread count,
        and your device&rsquo;s push token pass through the relay at{" "}
        <code>kurir-notify.arvidson.io</code> on their way to Apple&rsquo;s
        Push Notification service. The relay is stateless: it stores nothing
        and logs no notification content.
      </p>

      <h2 className="font-serif text-lead font-semibold">
        What the app does not do
      </h2>
      <p>
        The app contains no analytics, no tracking, and no third-party SDKs.
        No usage data is collected or transmitted to the developer.
      </p>

      <h2 className="font-serif text-lead font-semibold">
        Responsibilities under GDPR
      </h2>
      <p>
        The relay transit described above is the only processing the developer
        is responsible for. For the mail itself, the controller is whoever
        administers the server you connect to — yourself, if you self-host.
        For questions or requests concerning the relay transit, contact{" "}
        <a
          href="mailto:carl-fredrik@arvidson.io"
          className="text-primary hover:underline"
        >
          carl-fredrik@arvidson.io
        </a>
        . You also have the right to lodge a complaint with the Swedish
        Authority for Privacy Protection (IMY,{" "}
        <a
          href="https://www.imy.se"
          className="text-primary hover:underline"
          rel="noopener noreferrer"
        >
          imy.se
        </a>
        ).
      </p>
    </>
  );
}
