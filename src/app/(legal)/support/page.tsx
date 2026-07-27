import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — Kurir",
};

export default function SupportPage() {
  return (
    <>
      <h1 className="font-serif text-title font-semibold tracking-tight">
        Support
      </h1>

      <p>
        Questions, bug reports, or feedback about the Kurir app? Email{" "}
        <a
          href="mailto:carl-fredrik@arvidson.io"
          className="text-primary hover:underline"
        >
          carl-fredrik@arvidson.io
        </a>
        .
      </p>

      <h2 className="font-serif text-lead font-semibold">
        Connecting to your own server
      </h2>
      <p>
        Kurir is a client for self-hosted Kurir servers. On the app&rsquo;s
        sign-in screen, enter the address of your server (for example{" "}
        <code>mail.example.com</code>) — the app opens your server&rsquo;s own
        web sign-in, and once you approve, the app syncs your mail from that
        server. Your account lives on your server, not with the developer; if
        you have trouble signing in, check that your server is reachable and
        that your account exists there.
      </p>

      <h2 className="font-serif text-lead font-semibold">Legal</h2>
      <p>
        See the{" "}
        <a href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="/terms" className="text-primary hover:underline">
          Terms of Use
        </a>
        .
      </p>
    </>
  );
}
