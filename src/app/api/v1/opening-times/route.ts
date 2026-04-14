import { NextResponse } from "next/server";

import {
  checkApiRateLimit,
  jsonError,
  methodNotAllowed,
  requireWebsiteApiKey,
} from "@/lib/public-api/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { resolveOpeningTimes } from "@/lib/opening-hours";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns today's date (YYYY-MM-DD) in the Europe/London timezone. */
function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

/** Adds `n` days to a YYYY-MM-DD string and returns the result. */
function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const rateLimitResponse = await checkApiRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  // ── Parse query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const venueIdParam = searchParams.get("venueId");

  let days = DEFAULT_DAYS;
  if (daysParam !== null) {
    const parsed = Number(daysParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
      return jsonError(
        400,
        "invalid_params",
        `'days' must be an integer between 1 and ${MAX_DAYS}`
      );
    }
    days = parsed;
  }

  if (venueIdParam !== null && !UUID_RE.test(venueIdParam)) {
    return jsonError(400, "invalid_params", "'venueId' must be a valid UUID");
  }

  // ── DB client ───────────────────────────────────────────────────────────────
  let supabase;
  try {
    supabase = await createSupabaseReadonlyClient();
  } catch (error) {
    console.error("Public API: Supabase readonly client is not configured", error);
    return jsonError(503, "not_configured", "Supabase readonly client is not configured");
  }

  const from = todayInLondon();
  const to = addDays(from, days - 1);

  // ── Fetch data in parallel ─────────────────────────────────────────────────
  const venuesQuery = supabase
    .from("venues")
    .select("id, name")
    .order("name", { ascending: true });

  const [venuesResult, serviceTypesResult, weeklyHoursResult, overridesResult] =
    await Promise.all([
      venueIdParam ? venuesQuery.eq("id", venueIdParam) : venuesQuery,
      supabase
        .from("venue_service_types")
        .select("id, name, display_order, created_at")
        .order("display_order")
        .order("name"),
      venueIdParam
        ? supabase
            .from("venue_opening_hours")
            .select("*")
            .eq("venue_id", venueIdParam)
        : supabase.from("venue_opening_hours").select("*"),
      supabase
        .from("venue_opening_overrides")
        .select("*, venue_opening_override_venues(venue_id)")
        .gte("override_date", from)
        .lte("override_date", to)
        .order("override_date"),
    ]);

  if (venuesResult.error) {
    console.error("Public API /opening-times: venues query failed", venuesResult.error);
    return jsonError(500, "internal_error", "Unable to load venues");
  }
  if (venueIdParam && venuesResult.data.length === 0) {
    return jsonError(404, "not_found", "Venue not found");
  }
  if (serviceTypesResult.error) {
    console.error("Public API /opening-times: service types query failed", serviceTypesResult.error);
    return jsonError(500, "internal_error", "Unable to load service types");
  }
  if (weeklyHoursResult.error) {
    console.error("Public API /opening-times: opening hours query failed", weeklyHoursResult.error);
    return jsonError(500, "internal_error", "Unable to load opening hours");
  }
  if (overridesResult.error) {
    console.error("Public API /opening-times: overrides query failed", overridesResult.error);
    return jsonError(500, "internal_error", "Unable to load opening overrides");
  }

  // Flatten override junction table rows into venue_ids[]
  type RawOverrideRow = {
    id: string;
    override_date: string;
    service_type_id: string;
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean;
    note: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    venue_opening_override_venues: Array<{ venue_id: string }> | null;
  };
  const overrides: OpeningOverrideRow[] = (overridesResult.data ?? []).map((row: RawOverrideRow) => ({
    id: row.id,
    override_date: row.override_date,
    service_type_id: row.service_type_id,
    open_time: row.open_time,
    close_time: row.close_time,
    is_closed: row.is_closed,
    note: row.note ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    venue_ids: (row.venue_opening_override_venues ?? []).map((v) => v.venue_id),
  }));

  // When filtering to one venue, restrict overrides to those that include it
  const filteredOverrides = venueIdParam
    ? overrides.filter((o) => o.venue_ids.includes(venueIdParam))
    : overrides;

  const result = resolveOpeningTimes({
    serviceTypes: serviceTypesResult.data as ServiceTypeRow[],
    weeklyHours: weeklyHoursResult.data as OpeningHoursRow[],
    overrides: filteredOverrides,
    venues: venuesResult.data,
    from,
    days,
  });

  return NextResponse.json(result, {
    headers: {
      "cache-control": "max-age=300, stale-while-revalidate=3600",
    },
  });
}

export function POST() { return methodNotAllowed(); }
export function PUT() { return methodNotAllowed(); }
export function PATCH() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }
