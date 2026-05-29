"use client";

import { useEffect, useRef } from "react";
import {
  sanitizeEmailHtmlWithMeta,
  type CidAttachment,
} from "@/lib/mail/sanitize-html";

interface EmailBodyFrameProps {
  html: string;
  /** When true, blockquote / gmail_quote elements are stripped before rendering. */
  collapseQuotes?: boolean;
  /** Message attachments for CID→URL rewriting */
  attachments?: CidAttachment[];
  /**
   * When true, remote images are not requested (tracker blocking). Flip to
   * false (e.g. after the user clicks "Load images") to re-render with the
   * remote images proxied normally.
   */
  blockRemoteImages?: boolean;
  /** Reports how many remote images were blocked on the last render. */
  onBlockedCount?: (count: number) => void;
}

/**
 * Renders sanitized email HTML inside a Shadow DOM so the email's CSS is
 * isolated from the host page but the content still participates in normal
 * page layout and scrolling.
 *
 * Why not an iframe?
 * - Iframes load asynchronously, so the body would render at zero height and
 *   then "pop in" once measured.
 * - On mobile, touch events on iframe content do not bubble to the parent,
 *   so vertical/horizontal scrolling could get trapped.
 *
 * Safety: `sanitizeEmailHtml` strips script tags, event handler attributes,
 * style/iframe/object/embed/form tags, and CSS url() values. With those
 * gone, there is no JS execution path inside the shadow root.
 *
 * On mobile, wide emails (e.g. 600px newsletters on a 375px screen) are
 * scaled down via transform:scale() so they fit without horizontal scroll.
 */
export function EmailBodyFrame({
  html,
  collapseQuotes,
  attachments,
  blockRemoteImages,
  onBlockedCount,
}: EmailBodyFrameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Hold the callback in a ref so changing its identity doesn't re-run the
  // effect (which would re-sanitize on every parent render).
  const onBlockedCountRef = useRef(onBlockedCount);
  onBlockedCountRef.current = onBlockedCount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const { html: sanitized, blockedRemoteImages } = sanitizeEmailHtmlWithMeta(
      html,
      { collapseQuotes, attachments, blockRemoteImages },
    );
    onBlockedCountRef.current?.(blockedRemoteImages);
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${BASE_STYLES}</style><div class="scaler"><div class="content">${sanitized}</div></div>`;

    const scaler = shadow.querySelector(".scaler") as HTMLDivElement | null;
    const content = shadow.querySelector(".content") as HTMLDivElement | null;
    if (!scaler || !content) return;

    function measure() {
      if (!host || !scaler || !content) return;
      // Reset to natural width so we can measure the email's intrinsic size.
      scaler.style.transform = "";
      scaler.style.width = "100%";
      scaler.style.height = "";

      const containerWidth = host.offsetWidth;
      const contentWidth = content.scrollWidth;
      if (containerWidth === 0 || contentWidth <= containerWidth) return;

      let scale = containerWidth / contentWidth;
      // Below 0.5x text becomes illegible.
      scale = Math.max(scale, 0.5);
      // Skip near-1.0 transforms to avoid sub-pixel artifacts.
      if (scale > 0.95) return;

      scaler.style.transform = `scale(${scale})`;
      scaler.style.width = `${100 / scale}%`;
      // Shrink the layout box to match the visually scaled height.
      scaler.style.height = `${content.scrollHeight * scale}px`;
    }

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(host);

    // Re-measure once images load; their final size may push content wider.
    const imgs = content.querySelectorAll("img");
    const onImgLoad = () => measure();
    imgs.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onImgLoad);
    });

    return () => {
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener("load", onImgLoad));
    };
  }, [html, collapseQuotes, attachments, blockRemoteImages]);

  return <div ref={hostRef} className="bg-white" />;
}

/**
 * Styles applied inside the shadow root. They cannot leak out and host page
 * styles cannot leak in (other than CSS custom properties, which is fine).
 *
 * Forces light mode — email HTML almost never properly supports dark mode.
 */
const BASE_STYLES = `
  :host {
    display: block;
    color-scheme: light;
    color: #1a1a1a;
    background: #ffffff;
  }
  .scaler {
    transform-origin: top left;
    width: 100%;
  }
  .content {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-break: break-word;
    overflow-wrap: break-word;
    padding: 4px;
  }
  .content *, .content *::before, .content *::after { box-sizing: border-box; }
  .content img { max-width: 100% !important; height: auto !important; }
  .content a { color: #2563eb; }
  .content pre, .content code { white-space: pre-wrap; max-width: 100%; overflow-x: auto; }
  .content table { max-width: 100% !important; }
  .content table[width] { width: 100% !important; }
  .content blockquote {
    margin: 8px 0 8px 16px;
    padding-left: 12px;
    border-left: 3px solid #d1d5db;
    color: #6b7280;
  }
  .content div, .content td, .content th, .content p, .content span { max-width: 100%; }

  @media print {
    .content { padding: 0; }
    .content a { color: inherit; text-decoration: underline; }
  }
`;
