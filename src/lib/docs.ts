/**
 * The public documentation site. Clients link out to it; nothing is ever
 * sent to kurir.io (no auth, no query params) — these are plain outbound
 * links, and the same two URLs are hardcoded in the iPhone/Mac app.
 */

export const DOCS_URL = "https://kurir.io/docs";
export const DOCS_DRAFT_GENERATION_URL = "https://kurir.io/docs/draft-generation";
