import "server-only";

/**
 * Simple in-process sliding-window rate limiter for the public API.
 *
 * IMPORTANT: This implementation is in-process and works per serverless instance.
 * In a horizontally-scaled or serverless deployment (e.g., Vercel), each cold-start
 * creates a fresh counter, so the effective limit is `limit * number_of_instances`.
 *
 * For a production multi-instance deployment, replace the store below with a
 * distributed counter such as Upstash Redis (@upstash/ratelimit) which is
 * compatible with both Edge and Node runtimes on Vercel.
 *
 * Current settings: 120 requests per IP per 60 seconds.
 */

const WINDOW_MS = 60_000; // 60 seconds
const MAX_REQUESTS = 120; // per IP per window

type WindowEntry = {
  count: number;
  resetAt: number;
};

// Module-level store — survives across requests within the same instance lifetime.
const store = new Map<string, WindowEntry>();

// Periodically purge expired entries to prevent unbounded memory growth.
// The interval is held as a reference so it doesn't block Node process exit.
const cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  },
  WINDOW_MS * 2
);
if (cleanupInterval.unref) cleanupInterval.unref();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Check and record a request from the given identifier (typically an IP address).
 * Returns whether the request is allowed and the rate-limit state for response headers.
 */
export function checkRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  const existing = store.get(identifier);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    store.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt };
  }

  existing.count += 1;
  const allowed = existing.count <= MAX_REQUESTS;
  return {
    allowed,
    remaining: Math.max(0, MAX_REQUESTS - existing.count),
    resetAt: existing.resetAt
  };
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
