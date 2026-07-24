/**
 * Contract version for /api/mobile/*. Bump ONLY on breaking changes
 * (removed/renamed fields, changed semantics, removed endpoints).
 * Additive changes do not bump. Servers without /api/mobile/meta are
 * treated as version 1 by clients.
 */
export const MOBILE_API_VERSION = 1;

// Oldest app contract this server still serves. Raise together with
// MOBILE_API_VERSION only when old-app support is deliberately dropped.
export const MIN_SUPPORTED_APP_API_VERSION = 1;
