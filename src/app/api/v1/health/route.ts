import { NextResponse } from "next/server";

import { requireWebsiteApiKey } from "@/lib/public-api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

