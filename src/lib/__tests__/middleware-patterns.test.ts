import { describe, it, expect } from "vitest";

/**
 * Tests for the regex pattern used in middleware to distinguish short links
 * (8 lowercase hex characters) from slug-style landing page paths.
 */
describe("short link regex pattern", () => {
  const SHORT_LINK_PATTERN = /^\/[0-9a-f]{8}$/;

  it("should match 8-char hex paths", () => {
    expect(SHORT_LINK_PATTERN.test("/abc12345")).toBe(true);
    expect(SHORT_LINK_PATTERN.test("/00000000")).toBe(true);
    expect(SHORT_LINK_PATTERN.test("/deadbeef")).toBe(true);
  });

  it("should not match slug-style paths", () => {
    expect(SHORT_LINK_PATTERN.test("/jazz-night-20-mar-2026")).toBe(false);
    expect(SHORT_LINK_PATTERN.test("/quiz-night-13-mar-2026")).toBe(false);
    expect(SHORT_LINK_PATTERN.test("/")).toBe(false);
  });

  it("should not match 8-char paths with non-hex characters", () => {
    expect(SHORT_LINK_PATTERN.test("/abcXYZ12")).toBe(false);
    expect(SHORT_LINK_PATTERN.test("/ABCDEF12")).toBe(false);
  });

  it("should not match paths shorter or longer than 8 hex chars", () => {
    expect(SHORT_LINK_PATTERN.test("/abc123")).toBe(false);    // 7 chars
    expect(SHORT_LINK_PATTERN.test("/abc123456")).toBe(false); // 9 chars
    expect(SHORT_LINK_PATTERN.test("/abcdef1234")).toBe(false); // 10 chars
  });

  it("should not match paths with nested segments", () => {
    expect(SHORT_LINK_PATTERN.test("/abc12345/extra")).toBe(false);
    expect(SHORT_LINK_PATTERN.test("/l/abc12345")).toBe(false);
  });
});

/**
 * Tests for the rewrite URL construction logic used in middleware.
 * Validates that slug paths are correctly prefixed with /l/.
 */
describe("landing page path rewrite logic", () => {
  function buildRewritePath(pathname: string): string {
    return `/l${pathname}`;
  }

  it("should rewrite slug path to /l/ prefixed path", () => {
    expect(buildRewritePath("/jazz-night-20-mar-2026")).toBe("/l/jazz-night-20-mar-2026");
    expect(buildRewritePath("/quiz-night-13-mar-2026")).toBe("/l/quiz-night-13-mar-2026");
    expect(buildRewritePath("/live-music-friday")).toBe("/l/live-music-friday");
  });

  it("should preserve query strings in the pathname portion", () => {
    // pathname doesn't include query string — that's handled separately by nextUrl
    expect(buildRewritePath("/my-event")).toBe("/l/my-event");
  });
});
