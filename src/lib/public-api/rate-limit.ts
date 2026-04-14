import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedisClient } from "@/lib/redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// ── In-memory fallback (dev/missing Redis) ────────────────────────────────────

type WindowEntry = { count: number; resetAt: number };

class InMemoryLimiter {
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

// ── Rate limiter factory ──────────────────────────────────────────────────────

const redis = getRedisClient();

// Upstash Ratelimit instance — shared across all requests, persisted in Redis
const upstashLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, "60 s"),
      prefix: "ratelimit:public-api",
    })
  : null;

// Fallback in-memory limiter for dev
const memoryLimiter = new InMemoryLimiter({ windowMs: 60_000, maxRequests: 120 });

/**
 * Check rate limit for a given identifier (typically client IP).
 * Uses Upstash Redis in production, falls back to in-memory in dev.
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  if (upstashLimiter) {
    try {
      const result = await upstashLimiter.limit(identifier);
      return {
        allowed: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      };
    } catch (error) {
      console.error("[rate-limit] Upstash error, falling back to in-memory:", error);
      // Fall through to in-memory
    }
  }
  return memoryLimiter.check(identifier);
}

// ── Booking rate limiter ──────────────────────────────────────────────────────

const upstashBookingLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "ratelimit:booking",
    })
  : null;

const memoryBookingLimiter = new InMemoryLimiter({ windowMs: 60_000, maxRequests: 10 });

/**
 * Rate limit for the public booking flow — tighter than the API limiter.
 */
export async function checkBookingRateLimit(identifier: string): Promise<RateLimitResult> {
  if (upstashBookingLimiter) {
    try {
      const result = await upstashBookingLimiter.limit(identifier);
      return {
        allowed: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      };
    } catch (error) {
      console.error("[rate-limit] Upstash booking error, falling back to in-memory:", error);
    }
  }
  return memoryBookingLimiter.check(identifier);
}

/**
 * Extract the client IP from a Request, respecting common proxy headers.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
