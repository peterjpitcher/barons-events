import "server-only";

import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "./rate-limit";

const API_KEY_ENV = "EVENTHUB_WEBSITE_API_KEY";

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)\s*$/i);
  return match?.[1] ?? null;
}

export function jsonError(status: number, code: string, message: string, details?: unknown): Response {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? null : { details })
      }
    },
    {
      status,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

export function methodNotAllowed(allowed: string[] = ["GET"]): Response {
  return NextResponse.json(
    { error: { code: "method_not_allowed", message: `Only ${allowed.join(", ")} requests are accepted` } },
    {
      status: 405,
      headers: {
        allow: allowed.join(", "),
        "cache-control": "no-store"
      }
    }
  );
}

/**
 * Check the rate limit for the request. Returns a 429 response if exceeded, otherwise null.
 * Should be called before requireWebsiteApiKey so unauthenticated probing is also rate-limited.
 */
export function checkApiRateLimit(request: Request): Response | null {
  const ip = getClientIp(request);
  const result = checkRateLimit(ip);

  if (!result.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please slow down." } },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          "x-ratelimit-limit": "120",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
          "cache-control": "no-store"
        }
      }
    );
  }

  return null;
}

export function requireWebsiteApiKey(request: Request): Response | null {
  const expected = process.env[API_KEY_ENV];

  if (!expected) {
    return jsonError(503, "not_configured", `${API_KEY_ENV} is not configured on this server`);
  }

  const provided = readBearerToken(request);
  if (!provided) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Missing API key"
        }
      },
      {
        status: 401,
        headers: {
          "www-authenticate": "Bearer",
          "cache-control": "no-store"
        }
      }
    );
  }

  if (!constantTimeEquals(provided, expected)) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Invalid API key"
        }
      },
      {
        status: 401,
        headers: {
          "www-authenticate": "Bearer",
          "cache-control": "no-store"
        }
      }
    );
  }

  return null;
}

