import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "../rate-limit";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
  });

  it("should allow requests within the limit", () => {
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
  });

  it("should block requests over the limit", () => {
    limiter.check("ip2");
    limiter.check("ip2");
    limiter.check("ip2");
    expect(limiter.check("ip2").allowed).toBe(false);
  });

  it("should track separate identifiers independently", () => {
    limiter.check("ip3");
    limiter.check("ip3");
    limiter.check("ip3");
    limiter.check("ip3"); // blocked
    expect(limiter.check("ip4").allowed).toBe(true); // ip4 unaffected
  });

  it("should return correct remaining count", () => {
    const result = limiter.check("ip5");
    expect(result.remaining).toBe(2);
  });
});
