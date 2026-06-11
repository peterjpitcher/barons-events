// Isomorphic-safe: no server-only imports. In client bundles the env var is
// absent, so the production default applies — matching the previous hardcoded
// behaviour. Server code (redirect route, actions, system links) honours
// SHORT_LINK_HOST overrides, so all server-built URLs share one source of truth.

/** The hostname that serves short links (e.g. l.baronspubs.com). */
export const SHORT_LINK_HOST = process.env.SHORT_LINK_HOST ?? "l.baronspubs.com";

/** Base URL for short links, derived from SHORT_LINK_HOST (single source of truth). */
export const SHORT_LINK_BASE_URL = `https://${SHORT_LINK_HOST}/`;
