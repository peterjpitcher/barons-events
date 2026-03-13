import "server-only";

/**
 * Configurable in-process sliding-window rate limiter.
 *
 * IMPORTANT: In-process — each Vercel cold-start gets a fresh counter.
 * For production multi-instance deployments, replace with Upstash Redis.
 */

type WindowEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export class RateLimiter {
  private store = new Map<string, WindowEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor({ windowMs, maxRequests }: { windowMs: number; maxRequests: number }) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.resetAt <= now) this.store.delete(key);
      }
    }, windowMs * 2);
    if (interval.unref) interval.unref();
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const existing = this.store.get(identifier);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.store.set(identifier, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    existing.count += 1;
    const allowed = existing.count <= this.maxRequests;
    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetAt: existing.resetAt,
    };
  }
}

/** Default instance for the public event API — 120 req/60 s. */
export const publicApiLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 120 });

/** Backward-compatible export so existing callers don't need updating. */
export function checkRateLimit(identifier: string): RateLimitResult {
  return publicApiLimiter.check(identifier);
}

/**
 * Extract the client IP from a Request, respecting common proxy headers.
 * Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
