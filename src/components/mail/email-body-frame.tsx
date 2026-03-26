"use client";

import { useEffect, useRef, useState } from "react";
import {
  sanitizeEmailHtml,
  type CidAttachment,
} from "@/lib/mail/sanitize-html";

interface EmailBodyFrameProps {
  html: string;
  /** When true, blockquote / gmail_quote elements are stripped before rendering. */
  collapseQuotes?: boolean;
  /** Message attachments for CID→URL rewriting */
  attachments?: CidAttachment[];
}

/**
 * Renders sanitized email HTML inside a sandboxed iframe.
 *
 * Isolation properties:
 * - sandbox="allow-same-origin allow-popups" — allows ResizeObserver to measure
 *   body height and lets links open in new tabs; scripts, forms, and
 *   top-level navigation are all blocked.
 * - srcdoc — content is set directly; no external URL is loaded.
 * - The iframe has no name, so it cannot be targeted by other frames.
 *
 * Auto-resizes to fit content via ResizeObserver on the iframe's body.
 * Falls back to max-height + scroll for very tall emails.
 *
 * On mobile, wide emails (e.g. 600px newsletters on a 375px screen) are
 * scaled down via transform:scale() so they fit without horizontal scroll.
 */
export function EmailBodyFrame({
  html,
  collapseQuotes,
  attachments,
}: EmailBodyFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const srcdoc = mounted ? buildSrcdoc(html, collapseQuotes, attachments) : "";

  useEffect(() => {
    const iframe = iframeRef.current;
    const wrapper = wrapperRef.current;
    if (!iframe || !wrapper || !mounted) return;

    let observer: ResizeObserver | null = null;

    function measure() {
      const body = iframe?.contentDocument?.body;
      if (!body || !wrapper) return;

      const contentHeight = body.scrollHeight;
      const contentWidth = body.scrollWidth;
      const containerWidth = wrapper.offsetWidth;

      // Scale down wide emails to fit the container
      let scaleFactor = 1;
      if (contentWidth > containerWidth) {
        scaleFactor = containerWidth / contentWidth;
        // Cap minimum scale — below 0.5x text becomes illegible
        scaleFactor = Math.max(scaleFactor, 0.5);
        // Skip near-1.0 transforms to avoid sub-pixel artifacts
        if (scaleFactor > 0.95) scaleFactor = 1;
      }

      setScale(scaleFactor);
      setHeight(contentHeight);
    }

    function onLoad() {
      const body = iframe?.contentDocument?.body;
      if (!body) return;

      measure();

      observer = new ResizeObserver(() => measure());
      observer.observe(body);
    }

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcdoc, mounted]);

  if (!mounted) return null;

  const visualHeight = height * scale;

  return (
    <div
      ref={wrapperRef}
      className="overflow-hidden"
      style={{ height: visualHeight }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        title="Email content"
        aria-label="Email body"
        style={{
          height,
          width: scale < 1 ? `${100 / scale}%` : "100%",
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
        }}
        className="block border-0 bg-white"
      />
    </div>
  );
}

/**
 * CSS reset + overrides injected into every email document.
 * Forces light mode — email HTML almost never properly supports dark mode.
 * Uses !important on background/color to override dark inline styles from
 * emails that detect prefers-color-scheme: dark.
 */
const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff !important;
    color: #1a1a1a !important;
    color-scheme: light !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  body { padding: 0 4px; max-width: 100%; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  pre, code { white-space: pre-wrap; max-width: 100%; overflow-x: auto; }
  table { max-width: 100% !important; }
  table[width] { width: 100% !important; }
  blockquote {
    margin: 8px 0 8px 16px;
    padding-left: 12px;
    border-left: 3px solid #d1d5db;
    color: #6b7280;
  }
  div, td, th, p, span { max-width: 100%; }

  /* Override dark-mode media queries that some emails inject */
  @media (prefers-color-scheme: dark) {
    html, body { background: #ffffff !important; color: #1a1a1a !important; }
  }

  /* Print styles */
  @media print {
    body { padding: 0; }
    a { color: inherit; text-decoration: underline; }
  }
`;

function buildSrcdoc(
  html: string,
  collapseQuotes?: boolean,
  attachments?: CidAttachment[],
): string {
  const sanitized = sanitizeEmailHtml(html, { collapseQuotes, attachments });
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
