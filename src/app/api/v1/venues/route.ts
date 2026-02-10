import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, requireWebsiteApiKey } from "@/lib/public-api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  let supabase;
  try {
    supabase = createSupabaseServiceRoleClient();
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

  const venues = (data ?? []).map((venue: any) => ({
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
