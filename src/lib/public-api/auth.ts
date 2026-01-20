import "server-only";

import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

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

