---
date: 2026-03-21
topic: attachments-and-compose
---

# Attachments, Inline Images & Compose Flow

## What We're Building

A GitHub-style composer that supports:
- **Plain text editing** with markdown preview toggle (Write/Preview tabs like GitHub)
- **File attachments** via file picker, drag & drop, and clipboard paste
- **Inline images** — dropping/pasting an image into the textarea auto-inserts `![](filename)` at cursor position
- **New compose flow** — standalone compose (not just reply), with the same attachment support
- **Attachment storage** in Postgres (`Bytes` column) initially, designed to swap to S3-compatible storage later

## Chosen Approach: Upload-First (GitHub Model)

Files upload immediately when added. By send-time, all attachments are already stored server-side.

### Upload Flow
1. User drops/pastes/picks a file → immediate upload via `POST /api/attachments`
2. Server stores content in DB (`Bytes`), returns attachment ID + serving URL
3. For images: `![uploading...](placeholder)` inserted at cursor, replaced with `![name](/api/attachments/{id})` on success
4. Non-image files appear as removable chips below the textarea
5. On send: server action receives body text + list of attachment IDs
6. Preview mode renders markdown body with working image URLs from the API

### Why This Approach
- Matches the GitHub composer UX the user wants
- Instant upload feedback with progress indicators
- Send is fast (files already persisted)
- Failed uploads caught before send, not during
- Clean undo-send: attachments already stored, just discard the draft message
- Trade-off: orphaned attachments need periodic cleanup (simple cron deleting unlinked attachments older than N hours)

## Key Decisions

- **Storage abstraction**: Introduce a thin storage interface (`saveAttachment`, `getAttachment`, `deleteAttachment`) so the Postgres implementation can be swapped for S3 later without touching the rest of the code
- **Attachment model reuse**: The existing `Attachment` model is tied to received messages (has `partId`, `encoding` for IMAP). Outbound attachments need a separate or extended model (no IMAP part reference, but needs the actual `content` blob)
- **GitHub-style composer**: Write/Preview toggle tabs. Textarea in Write mode, rendered markdown in Preview mode. Not a rich text editor.
- **Inline image markdown**: Pasting/dropping an image inserts `![filename](/api/attachments/{id})` at cursor position in the textarea
- **Serve route**: `GET /api/attachments/[id]` serves the binary content with proper `Content-Type` and `Content-Disposition` headers (inline for images, attachment for others)
- **Size limits**: Enforce per-file and total-per-message limits server-side
- **Compose-new**: New standalone compose component reusing the same attachment + markdown preview infrastructure as the reply composer

## Open Questions

- Max file size per attachment? (10MB? 25MB?)
- Max total attachments per message?
- Should the compose-new button live in the sidebar, the header, or both?
- Should we support forwarding-with-attachments from existing messages?
- Orphan cleanup interval — how aggressive? (e.g., delete unlinked attachments older than 24h)

## Next Steps

→ `/workflows:plan` for implementation details
