import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkApiRateLimit, jsonError, methodNotAllowed, requireWebsiteApiKey } from "@/lib/public-api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rateLimitResponse = checkApiRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    console.error("Public API: Supabase service role client is not configured", error);
    return jsonError(503, "not_configured", "Supabase service role is not configured");
  }
  const { data, error } = await supabase
    .from("venues")
    .select(
      `
      id,
      name,
      address,
      capacity
    `
    )
    .order("name", { ascending: true });

  if (error) {
    console.error("Public API: failed to list venues", error);
    return jsonError(500, "internal_error", "Unable to load venues");
  }

  type VenueSelectRow = { id: string; name: string; address: string | null; capacity: number | null };
  const venues = (data ?? []).map((venue: VenueSelectRow) => ({
    id: venue.id,
    name: venue.name,
    address: venue.address ?? null,
    capacity: venue.capacity ?? null
  }));

  return NextResponse.json(
    { data: venues },
    {
      headers: {
        "cache-control": "private, max-age=300, stale-while-revalidate=3600"
      }
    }
  );
}

export function POST() { return methodNotAllowed(); }
export function PUT() { return methodNotAllowed(); }
export function PATCH() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }
