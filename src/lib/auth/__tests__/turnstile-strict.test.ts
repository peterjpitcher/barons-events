/**
 * Tests for Turnstile strict-mode failure paths.
 *
 * Strict mode is the fail-closed contract for public-facing flows (e.g. booking).
 * Every degraded state (missing token, missing secret in prod, API failure) must
 * return false — unlike lenient mode which returns true.
 *
 * These tests cover gap 5.4 from the auth audit spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { verifyTurnstile } from "@/lib/turnstile";

describe("verifyTurnstile — strict mode failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret-key");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return false when token is null in strict mode", async () => {
    const result = await verifyTurnstile(null, "booking", "strict");

    expect(result).toBe(false);
    // fetch should not have been called — early return
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return false when TURNSTILE_SECRET_KEY is missing in production strict mode", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    const result = await verifyTurnstile("some-token", "booking", "strict");

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return false when the siteverify API returns a non-OK HTTP status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500
    });

    const result = await verifyTurnstile("some-token", "booking", "strict");

    expect(result).toBe(false);
  });

  it("should return false when the siteverify API throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("DNS resolution failed"));

    const result = await verifyTurnstile("some-token", "booking", "strict");

    expect(result).toBe(false);
  });

  it("should return true when the siteverify API returns success with matching action", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, action: "booking" })
    });

    const result = await verifyTurnstile("valid-token", "booking", "strict");

    expect(result).toBe(true);
  });

  it("should return false when the action does not match even with success=true", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, action: "login" })
    });

    const result = await verifyTurnstile("valid-token", "booking", "strict");

    expect(result).toBe(false);
  });

  it("should return false when the API returns success=false", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false })
    });

    const result = await verifyTurnstile("invalid-token", "booking", "strict");

    expect(result).toBe(false);
  });

  it("should allow missing secret in strict mode when NOT in production (dev convenience)", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");

    const result = await verifyTurnstile("some-token", "booking", "strict");

    // In dev, missing secret falls through to true (dev convenience)
    expect(result).toBe(true);
  });
});
