import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock redis to return null (no Redis available) so we test the in-memory fallback
vi.mock("@/lib/redis", () => ({
  getRedisClient: () => null,
}));

import { checkRateLimit, checkBookingRateLimit, getClientIp } from "../rate-limit";

describe("checkRateLimit (in-memory fallback)", () => {
  it("should allow requests within the limit", async () => {
    // 120 req/60s — first few should be fine
    const r1 = await checkRateLimit("test-ip-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(119);
  });

  it("should track separate identifiers independently", async () => {
    const r1 = await checkRateLimit("independent-a");
    const r2 = await checkRateLimit("independent-b");
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});

describe("checkBookingRateLimit (in-memory fallback)", () => {
  it("should allow requests within the limit", async () => {
    const r1 = await checkBookingRateLimit("booking-ip-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(9);
  });

  it("should block requests over the limit", async () => {
    const ip = "booking-ip-flood";
    for (let i = 0; i < 10; i++) {
      await checkBookingRateLimit(ip);
    }
    const blocked = await checkBookingRateLimit(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});

describe("getClientIp", () => {
  it("should extract IP from x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(request)).toBe("1.2.3.4");
  });

  it("should fall back to x-real-ip", () => {
    const request = new Request("http://localhost", {
      headers: { "x-real-ip": "9.8.7.6" },
    });
    expect(getClientIp(request)).toBe("9.8.7.6");
  });

  it("should return 'unknown' when no headers present", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });
});
