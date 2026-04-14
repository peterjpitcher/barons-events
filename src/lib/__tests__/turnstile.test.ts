import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { verifyTurnstile } from "../turnstile";

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("strict mode", () => {
    it("should return false when no token is provided", async () => {
      const result = await verifyTurnstile(null, "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when secret key is missing in production", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when siteverify API is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when siteverify returns non-OK", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return true when siteverify succeeds", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "booking" }),
      });
      const result = await verifyTurnstile("valid-token", "booking", "strict");
      expect(result).toBe(true);
    });

    it("should return false on action mismatch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "login" }),
      });
      const result = await verifyTurnstile("valid-token", "booking", "strict");
      expect(result).toBe(false);
    });
  });

  describe("lenient mode (default)", () => {
    it("should return true when no token is provided", async () => {
      const result = await verifyTurnstile(null, "booking");
      expect(result).toBe(true);
    });

    it("should return true when secret key is missing", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      const result = await verifyTurnstile("some-token", "booking");
      expect(result).toBe(true);
    });

    it("should return true when siteverify API is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const result = await verifyTurnstile("some-token", "booking");
      expect(result).toBe(true);
    });

    it("should return true when siteverify succeeds", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "booking" }),
      });
      const result = await verifyTurnstile("valid-token", "booking");
      expect(result).toBe(true);
    });

    it("should return false on action mismatch even in lenient mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "login" }),
      });
      const result = await verifyTurnstile("valid-token", "booking");
      expect(result).toBe(false);
    });
  });

  describe("strict mode in development", () => {
    it("should return true when secret key is missing in non-production", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      vi.stubEnv("NODE_ENV", "development");
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(true);
    });
  });
});
