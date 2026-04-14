import { NextResponse } from "next/server";

import { checkApiRateLimit, methodNotAllowed, requireWebsiteApiKey } from "@/lib/public-api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rateLimitResponse = await checkApiRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

export function POST() { return methodNotAllowed(); }
export function PUT() { return methodNotAllowed(); }
export function PATCH() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }
