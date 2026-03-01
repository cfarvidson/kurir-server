"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeEmailHtml } from "@/lib/mail/sanitize-html";

interface EmailBodyFrameProps {
  html: string;
  /** When true, blockquote / gmail_quote elements are stripped before rendering. */
  collapseQuotes?: boolean;
}

/**
 * Renders sanitized email HTML inside a sandboxed iframe.
 *
 * Isolation properties:
 * - sandbox="allow-same-origin" — allows ResizeObserver to measure body height;
 *   scripts, forms, popups, and top-level navigation are all blocked.
 * - srcdoc — content is set directly; no external URL is loaded.
 * - The iframe has no name, so it cannot be targeted by other frames.
 *
 * Auto-resizes to fit content via ResizeObserver on the iframe's body.
 * Falls back to max-height + scroll for very tall emails.
 */
export function EmailBodyFrame({ html, collapseQuotes }: EmailBodyFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [mounted, setMounted] = useState(false);

  // Only render on the client — DOMPurify needs a DOM and srcdoc must match
  // between server and client to avoid hydration mismatches.
  useEffect(() => setMounted(true), []);

  const srcdoc = mounted ? buildSrcdoc(html, collapseQuotes) : "";

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mounted) return;

    let observer: ResizeObserver | null = null;

    function onLoad() {
      const body = iframe?.contentDocument?.body;
      if (!body) return;

      setHeight(body.scrollHeight);

      observer = new ResizeObserver(() => {
        if (body) setHeight(body.scrollHeight);
      });
      observer.observe(body);
    }

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcdoc, mounted]);

  if (!mounted) return null;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      title="Email content"
      aria-label="Email body"
      style={{ height: Math.min(height, 2000) }}
      className="block w-full overflow-auto rounded border-0 bg-white dark:bg-neutral-900"
    />
  );
}

/** Minimal CSS reset + dark mode injected into every email document. */
const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  body { padding: 0 4px; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  pre, code { white-space: pre-wrap; }
  blockquote {
    margin: 8px 0 8px 16px;
    padding-left: 12px;
    border-left: 3px solid #d1d5db;
    color: #6b7280;
  }
  @media (prefers-color-scheme: dark) {
    html, body { background: #171717; color: #e5e5e5; }
    a { color: #60a5fa; }
    blockquote { border-left-color: #374151; color: #9ca3af; }
  }
`;

function buildSrcdoc(html: string, collapseQuotes?: boolean): string {
  const sanitized = sanitizeEmailHtml(html, { collapseQuotes });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base target="_blank">
<style>${BASE_STYLES}</style>
</head>
<body>${sanitized}</body>
</html>`;
}
