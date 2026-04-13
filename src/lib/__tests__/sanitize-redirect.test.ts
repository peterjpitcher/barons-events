import { describe, it, expect } from "vitest";

/**
 * Inline copy of the sanitizeRedirect logic used in login/page.tsx and auth.ts.
 * Kept here because the original is not exported — this tests the pattern itself.
 */
function sanitizeRedirect(path?: string | null): string {
  if (!path) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}

describe("sanitizeRedirect", () => {
  it("should return / for null", () => {
    expect(sanitizeRedirect(null)).toBe("/");
  });

  it("should return / for undefined", () => {
    expect(sanitizeRedirect(undefined)).toBe("/");
  });

  it("should return / for empty string", () => {
    expect(sanitizeRedirect("")).toBe("/");
  });

  it("should accept a valid relative path", () => {
    expect(sanitizeRedirect("/dashboard")).toBe("/dashboard");
  });

  it("should accept a valid path with query string", () => {
    expect(sanitizeRedirect("/events?page=2")).toBe("/events?page=2");
  });

  it("should accept a nested path", () => {
    expect(sanitizeRedirect("/admin/events/123")).toBe("/admin/events/123");
  });

  it("should reject absolute URLs (no leading slash)", () => {
    expect(sanitizeRedirect("https://evil.com")).toBe("/");
  });

  it("should reject protocol-relative URLs (double slash)", () => {
    expect(sanitizeRedirect("//evil.com")).toBe("/");
  });

  it("should reject backslash open redirect (\\\\evil.com)", () => {
    expect(sanitizeRedirect("/\\evil.com")).toBe("/");
  });

  it("should reject path with embedded backslash", () => {
    expect(sanitizeRedirect("/foo\\bar")).toBe("/");
  });

  it("should reject double-slash disguised with query", () => {
    expect(sanitizeRedirect("//evil.com/path?x=1")).toBe("/");
  });
});
