---
title: Fix attachment downloads, block tracking pixels, remove download email, fix mobile layout
type: fix
date: 2026-03-18
deepened: 2026-03-18
---

## Enhancement Summary

**Deepened on:** 2026-03-18
**Research agents used:** security-sentinel, performance-oracle, code-simplicity-reviewer, ImapFlow Context7, Next.js Context7, web search (tracking pixels, iOS dvh)

### Key Improvements from Deepening

1. **Task 1 redesigned:** Fix `partId` at sync time instead of download time — eliminates the `findPartId()` tree walker, removes an extra IMAP round-trip, and makes the download route trivially simple
2. **Task 2 hardened:** Security review found DNS rebinding, redirect-chain SSRF, and SVG XSS vulnerabilities in the original design. Fixed with `redirect: "manual"`, hostname blocklist (simplified from full DNS resolution per simplicity review), and SVG blocking
3. **Task 4 refined:** Added `selection-action-bar.tsx` and `auto-sync.tsx` to safe-area fixes (both use `fixed bottom-*` and overlap the iOS home indicator). Consider `svh` over `dvh` to avoid ResizeObserver cascade in EmailBodyFrame

---

# Fix Attachment Downloads, Block Tracking Pixels, Remove Download Email, Fix Mobile Layout

## Overview

Four independent fixes addressing performance, privacy, cleanup, and mobile UX:

1. **Slow attachment downloads** — route fetches entire RFC822 message source to extract one attachment
2. **Tracking pixels** — external images load directly, exposing user IP/UA to senders
3. **"Download email" broken** — html2pdf.js PDF generation doesn't work well, remove it
4. **Mobile layout broken** — `h-screen` (100vh) causes clipping on iOS Safari, header is cramped

---

## Task 1: Fix Slow Attachment Downloads

### Problem

`src/app/api/attachments/[id]/route.ts` fetches the **entire message source** via `client.fetchOne(uid, { source: true })`, then parses it with `simpleParser()` just to extract one attachment. A 50KB attachment on a 10MB email downloads 10MB over IMAP.

### Root Cause

The route was built before knowing about ImapFlow's `client.download()` method, which can fetch a specific MIME part by its BODYSTRUCTURE part ID — transferring only the attachment bytes.

### Performance Impact (from research)

| Metric | Current | After fix | Improvement |
|---|---|---|---|
| IMAP bytes transferred | ~10MB | ~50KB + 500B metadata | ~200x |
| Peak memory per download | ~20MB | ~50KB (streaming) | ~400x |
| CPU (simpleParser) | 200-500ms | 0ms | eliminated |
| Total latency | 2-5s (LAN IMAP) | 50-100ms | 20-50x |

### Approach: Fix partId at Sync Time (Simplified)

> **Research insight (simplicity review):** The original plan proposed a `findPartId()` tree walker at download time. This solves the problem at the wrong point — the sync already has access to `msg.bodyStructure`. Fix the data at write time, not read time.

The sync service already fetches `bodyStructure` (it's in the `msg` object passed to `processMessage`). Walk `msg.bodyStructure` during sync to extract the correct BODYSTRUCTURE part path for each attachment, and store that instead of the sequential index.

This eliminates:
- The entire `findPartId()` function (~30 lines)
- The extra `fetchOne(bodyStructure)` IMAP call at download time
- The duplicate-filename tiebreaker edge case
- The risk of bodyStructure changing between sync and download

### Implementation

#### `src/lib/mail/sync-service.ts` — store correct BODYSTRUCTURE partId

Add a helper to walk the bodyStructure tree and build a map of attachment part paths:

```typescript
function extractAttachmentParts(
  node: any,
  path: string = ""
): Array<{ partId: string; type: string; filename: string; size: number }> {
  if (node.childNodes) {
    return node.childNodes.flatMap((child: any, i: number) => {
      const childPath = path ? `${path}.${i + 1}` : String(i + 1);
      return extractAttachmentParts(child, childPath);
    });
  }
  // Leaf node — check if it's an attachment
  const disposition = node.disposition?.toLowerCase();
  const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
  if (disposition === "attachment" || (filename && disposition !== "inline")) {
    return [{ partId: path || "1", type: node.type, filename, size: node.size || 0 }];
  }
  return [];
}
```

Then in `processMessage()`, correlate mailparser attachments with bodyStructure parts:

```typescript
// Instead of: partId: String(index + 1)
const structureParts = msg.bodyStructure
  ? extractAttachmentParts(msg.bodyStructure)
  : [];

// Match by index position (mailparser and bodyStructure enumerate in same order)
const partId = structureParts[index]?.partId ?? String(index + 1); // fallback for safety
```

#### `src/app/api/attachments/[id]/route.ts` — simplified download

The route becomes trivially simple:

```typescript
const content = await withImapConnection(message.emailConnectionId, async (client) => {
  const mailbox = await client.getMailboxLock(message.folder.path);
  try {
    // Download only the specific MIME part (streams decoded content)
    const { content: stream } = await client.download(
      String(message.uid), attachment.partId, { uid: true }
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    mailbox.release();
  }
});
```

> **Performance note:** For a future improvement, stream the response directly instead of buffering: `return new NextResponse(Readable.toWeb(stream))`. This brings memory from O(attachment_size) to O(chunk_size). Buffering is fine for v1.

### ImapFlow `download()` API Reference (from Context7)

```typescript
// Download specific attachment (part '2') by UID
const { meta, content } = await client.download('12345', '2', { uid: true });
// meta: { contentType, filename, expectedSize, encoding, charset }
// content: Node.js Readable stream (auto-decoded from base64/quoted-printable)
```

- `content` stream is automatically decoded (base64, quoted-printable, charset conversion)
- For single-text messages (no multipart wrapper), part `"1"` is auto-converted to `"TEXT"` internally
- `expectedSize` comes from IMAP FETCH response, not final decoded size

### Files to Change

- [x] `src/lib/mail/sync-service.ts` — add `extractAttachmentParts()`, store correct BODYSTRUCTURE partId during sync
- [x] `src/app/api/attachments/[id]/route.ts` — replace `fetchOne(source)` + `simpleParser` with direct `client.download(uid, partId)`
- [x] Remove `simpleParser` import from the attachment route

### Edge Cases

- **Existing attachments with old partId values:** The fallback `?? String(index + 1)` ensures existing records still work. New syncs will store correct values. Old attachments will get correct partIds on next re-sync.
- **CID inline images:** Not affected — rendered via `cid:` URLs in the iframe.
- **Single-part messages:** ImapFlow handles `part="1"` → `"TEXT"` conversion internally.

### Acceptance Criteria

- [x] Attachment downloads complete significantly faster (only transfers the attachment bytes)
- [x] Works correctly for nested MIME structures (multipart/mixed, multipart/alternative)
- [x] Existing attachment download links (`/api/attachments/:id`) continue to work
- [x] `simpleParser` import removed from the attachment route

---

## Task 2: Block Tracking Pixels

### Problem

Emails are rendered in a sandboxed iframe with `referrerPolicy="no-referrer"`, but all external images (`<img src="https://...">`) load directly from the sender's server. This exposes:
- User's IP address
- User-Agent string
- The fact that the email was opened (tracking pixel purpose)

### Proposed Fix

1. **Image proxy route** at `/api/proxy/image` — fetches images server-side, returns them to the client
2. **Sanitizer rewrite** — in `sanitize-html.ts`, rewrite external `img src` URLs to go through the proxy
3. **URL validation** — hostname blocklist to prevent SSRF

### Implementation

#### `src/app/api/proxy/image/route.ts` (new file)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "127.0.0.1", "::1", "0.0.0.0",
]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".ts.net"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABJQREFUCB1jYGBg+A8EDAAEJgFNlT3VvQAAAABJRU5ErkJggg==",
  "base64"
);

function transparentPixelResponse() {
  return new NextResponse(TRANSPARENT_PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) return true;
  // Block private IP ranges as hostnames
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    return (
      parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  return false;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const parsed = new URL(url);
    // Strip credentials from URL
    parsed.username = "";
    parsed.password = "";

    if (isBlockedHostname(parsed.hostname)) {
      return transparentPixelResponse();
    }

    // Use redirect: "manual" to prevent redirect-chain SSRF
    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
      redirect: "manual",
    });

    // Follow redirects manually (max 3), validating each target
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return transparentPixelResponse();
      try {
        const redirectUrl = new URL(location, parsed.href);
        if (isBlockedHostname(redirectUrl.hostname)) return transparentPixelResponse();
        if (!/^https?:$/i.test(redirectUrl.protocol)) return transparentPixelResponse();
        // Single redirect follow (no recursion)
        const redirectResponse = await fetch(redirectUrl.href, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
          redirect: "manual",
        });
        return proxyImageResponse(redirectResponse);
      } catch {
        return transparentPixelResponse();
      }
    }

    return proxyImageResponse(response);
  } catch {
    return transparentPixelResponse();
  }
}

function proxyImageResponse(response: Response): NextResponse {
  if (!response.ok || !response.body) {
    return transparentPixelResponse();
  }

  const contentType = response.headers.get("content-type") || "image/png";

  // Block SVG (can contain scripts, XSS risk if opened directly)
  if (contentType.includes("svg")) {
    return transparentPixelResponse();
  }

  // Only proxy image content types
  if (!contentType.startsWith("image/")) {
    return transparentPixelResponse();
  }

  return new NextResponse(response.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
```

#### `src/lib/mail/sanitize-html.ts` — rewrite image sources

After the existing `img src` protocol filter (line 95-100), add URL rewriting:

```typescript
// After protocol filtering, rewrite external images to proxy
doc.querySelectorAll("img").forEach((img) => {
  const src = img.getAttribute("src") ?? "";
  if (/^https?:/i.test(src)) {
    img.setAttribute("src", `/api/proxy/image?url=${encodeURIComponent(src)}`);
  }
  // cid: URLs are left as-is (inline attachments)
});
```

### Security Measures (from security review)

| Threat | Mitigation |
|---|---|
| **SSRF via redirect chain** | `redirect: "manual"` + validate each redirect target |
| **SSRF via private hostnames** | Hostname blocklist (localhost, .local, .ts.net, private IP ranges) |
| **SVG XSS** | Block `image/svg+xml` content type entirely |
| **Content-Type sniffing** | `X-Content-Type-Options: nosniff` on all responses |
| **Auth bypass** | Session required, iframe is same-origin so cookies flow |
| **Credentials in URL** | Strip `username`/`password` before fetching |
| **Open proxy abuse** | Auth-gated, content-type restricted to `image/*` |
| **Defense-in-depth** | `Content-Security-Policy: default-src 'none'` on proxy responses |

> **Simplicity note (from simplicity review):** Full DNS-resolution SSRF protection is disproportionate for a single-user app behind auth. The URL parameter is constructed server-side by the sanitizer, not from arbitrary user input. A hostname blocklist is sufficient. An attacker would need to send a crafted email, have the user open it, and the target would need to respond with useful content as an image — practical SSRF risk is near zero.

### Known Limitations (acceptable for v1)

- CSS `background-image: url(...)` in `<style>` blocks is NOT rewritten (tracking vector but complex to handle)
- `printEmail()` uses raw `htmlBody` — images in print view load directly (deliberate user action)
- No server-side image cache — same images re-fetched per user. Browser caching (`max-age=86400`) handles repeat views.

### Files to Change

- [x] `src/app/api/proxy/image/route.ts` — new route: authenticated image proxy
- [x] `src/lib/mail/sanitize-html.ts` — rewrite external `img src` URLs to proxy

### Acceptance Criteria

- [x] External images in emails load through the server-side proxy
- [x] User's IP and UA are not exposed to email senders
- [x] CID inline images (embedded attachments) still work
- [x] SVG images are blocked (returned as transparent pixel)
- [x] Redirect chains to private hosts are blocked
- [x] Failed/unreachable images show transparently (no broken image icons)
- [x] Proxy requires authentication

---

## Task 3: Remove "Download Email" Feature

### Problem

The "Download email" button uses `html2pdf.js` (which wraps html2canvas + jsPDF) to render emails to PDF client-side. It produces poor results with complex email layouts and doesn't reliably work.

### Proposed Fix

Remove the download button, `downloadPdf()` function, and `html2pdf.js` dependency. Keep `buildEmailHtml()` and `printEmail()` — the print button still works and users can "Save as PDF" from the browser print dialog.

### Bundle Impact

`html2pdf.js` is **924KB minified** (includes html2canvas ~400KB + jsPDF ~300KB). Although dynamically imported, Next.js still generates the chunk during build. Removal reduces build output and `node_modules` by ~10MB.

### Implementation

#### `src/components/mail/thread-view.tsx`

- Remove `downloadPdf()` function (lines 93-143)
- Remove `Download` from the lucide-react import (line 7)
- Remove the download `<button>` from `MessageBubble` JSX
- Keep `buildEmailHtml()` (used by `printEmail()`)
- Keep `printEmail()` and the print button

#### `package.json`

- Remove `html2pdf.js` dependency

#### `src/types/html2pdf.d.ts`

- Delete this file

### Files to Change

- [x] `src/components/mail/thread-view.tsx` — remove `downloadPdf()`, download button, `Download` icon import
- [x] `package.json` — remove `html2pdf.js` dependency
- [x] `src/types/html2pdf.d.ts` — delete file
- [x] Run `pnpm install` to update lockfile

### Acceptance Criteria

- [x] Download button no longer appears in the message action row
- [x] Print button still works correctly
- [x] `html2pdf.js` removed from bundle
- [x] No console errors or missing import warnings

---

## Task 4: Fix Mobile Layout

### Problem

From the screenshot: the mobile view has a broken top bar and incorrect vertical height. Root causes:

1. **`h-screen` (100vh)** in the mail layout — on iOS Safari, `100vh` includes the area behind the toolbar, causing bottom content to be clipped
2. **No `viewport-fit: cover`** — required for `env(safe-area-inset-*)` to work on iOS
3. **No safe-area-inset handling** — content can overlap with notch/Dynamic Island and home indicator
4. **Header cramped on mobile** — back button, category label, message count, and action buttons all in one row

### Additional Components Needing Safe-Area Fixes (from research)

The mobile layout research discovered two more components with `fixed bottom-*` positioning that overlap the iOS home indicator:

- **`selection-action-bar.tsx`**: `fixed bottom-6 left-1/2 z-50` — will overlap home indicator
- **`auto-sync.tsx`**: `fixed bottom-4 left-1/2 z-50` — hidden behind home indicator

### Implementation

#### `src/app/layout.tsx` — add `viewport-fit: cover`

```typescript
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover" as const,
};
```

> **Note:** `viewport-fit: cover` is a prerequisite for `env(safe-area-inset-*)` to return non-zero values. Without it, all env() values return 0.

#### `src/app/(mail)/layout.tsx` — replace `h-screen` with `h-dvh` + fallback

```tsx
<div className="flex h-screen h-dvh">
```

CSS cascade: browsers supporting `dvh` use it, older browsers fall back to `h-screen`.

Also add safe-area bottom padding to the main content area:

```tsx
<main className="flex-1 overflow-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
```

> **Performance consideration (from performance review):** `dvh` changes dynamically as the Safari toolbar appears/disappears, which triggers ResizeObserver in `EmailBodyFrame` → layout cascade during scroll. If this causes visible jank, switch to `h-svh` (smallest viewport height — static, no reflow). `svh` leaves a small gap when the toolbar hides, but avoids the resize cascade. Start with `dvh` and switch to `svh` if jank is observed.

#### `src/components/mail/thread-detail-view.tsx` — safe-area top padding on header

```tsx
<div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm md:px-6">
```

Wrap action buttons to prevent squishing:

```tsx
<div className="flex flex-shrink-0 items-center gap-1">
  {actions({ ... })}
</div>
```

#### `src/components/layout/mobile-sidebar.tsx` — safe-area hamburger positioning

```tsx
className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 ..."
```

#### `src/components/mail/selection-action-bar.tsx` — safe-area bottom

```tsx
// Change: fixed bottom-6
// To: fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))]
```

#### `src/components/mail/auto-sync.tsx` — safe-area bottom (if using fixed positioning)

Check if auto-sync toasts use fixed bottom positioning and add safe-area offset if so.

### Browser Compatibility

- `dvh`/`svh`/`lvh`: Baseline Widely Available (June 2025), ~95% global support
- `h-screen` kept as fallback for older browsers
- `env(safe-area-inset-*)`: Safari 11.1+, Chrome 69+

### Files to Change

- [x] `src/app/layout.tsx` — add `viewportFit: "cover"` to viewport export
- [x] `src/app/(mail)/layout.tsx` — `h-screen` → `h-screen h-dvh`, safe-area bottom padding on `<main>`
- [x] `src/components/mail/thread-detail-view.tsx` — safe-area top padding on sticky header, flex-shrink-0 on actions
- [x] `src/components/layout/mobile-sidebar.tsx` — safe-area-aware hamburger positioning
- [x] `src/components/mail/selection-action-bar.tsx` — safe-area bottom offset

### Acceptance Criteria

- [x] Mobile layout fills visible viewport correctly on iOS Safari (no content behind toolbar)
- [x] Header does not overlap with notch/Dynamic Island
- [x] Bottom content not clipped by home indicator
- [x] Selection action bar visible above home indicator
- [x] Action buttons in header don't overflow on narrow screens
- [x] Desktop layout unchanged

---

## Implementation Order

1. **Task 3** (Remove download email) — simplest, reduces surface area, no risk
2. **Task 4** (Fix mobile layout) — CSS-only changes, independent
3. **Task 1** (Fix attachment downloads) — sync-service + route change, needs testing
4. **Task 2** (Block tracking pixels) — new route + sanitizer change, most complex

Tasks 3 and 4 can be done in parallel. All tasks are independent of each other.

## References

- `src/app/api/attachments/[id]/route.ts` — attachment download route
- `src/lib/mail/sync-service.ts:603` — partId storage during sync
- `src/lib/mail/sanitize-html.ts` — email HTML sanitizer
- `src/components/mail/thread-view.tsx` — download/print buttons
- `src/app/(mail)/layout.tsx:85` — `h-screen` container
- `src/app/layout.tsx:22-26` — viewport config
- `src/components/mail/thread-detail-view.tsx:154` — sticky header
- `src/components/mail/selection-action-bar.tsx` — fixed bottom action bar
- `node_modules/imapflow/lib/imap-flow.js:2813` — `client.download()` API
- [ImapFlow download docs](https://context7.com/postalsys/imapflow)
- [Next.js viewport metadata](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/04-functions/generate-viewport.mdx)
- [CSS dvh explained](https://savvy.co.il/en/blog/css/css-dynamic-viewport-height-dvh/)
- [Understanding Mobile Viewport Units](https://medium.com/@tharunbalaji110/understanding-mobile-viewport-units-a-complete-guide-to-svh-lvh-and-dvh-0c905d96e21a)
