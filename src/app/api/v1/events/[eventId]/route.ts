import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, requireWebsiteApiKey } from "@/lib/public-api/auth";
import { PUBLIC_EVENT_STATUSES, toPublicEvent, type RawEventRow } from "@/lib/public-api/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  eventId: z.string().uuid()
});

export async function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonError(400, "invalid_request", "Invalid event id");
  }

  const { eventId } = parsedParams.data;

  let supabase;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    console.error("Public API: Supabase service role client is not configured", error);
    return jsonError(503, "not_configured", "Supabase service role is not configured");
  }
  const { data, error } = await supabase
    .from("events")
    .select(
      `
      id,
      title,
      public_title,
      public_teaser,
      public_description,
      public_highlights,
      booking_type,
      ticket_price,
      check_in_cutoff_minutes,
      age_policy,
      accessibility_notes,
      cancellation_window_hours,
      terms_and_conditions,
      booking_url,
      event_image_path,
      seo_title,
      seo_description,
      seo_slug,
      event_type,
      status,
      start_at,
      end_at,
      venue_space,
      notes,
      wet_promo,
      food_promo,
      updated_at,
      venue:venues(
        id,
        name,
        address,
        capacity
      )
    `
    )
    .eq("id", eventId)
    .in("status", [...PUBLIC_EVENT_STATUSES])
    .maybeSingle();

  if (error) {
    console.error("Public API: failed to fetch event", error);
    return jsonError(500, "internal_error", "Unable to load event");
  }

  if (!data) {
    return jsonError(404, "not_found", "Event not found");
  }

  let event;
  try {
    event = toPublicEvent(data as unknown as RawEventRow);
  } catch (error) {
    console.error("Public API: failed to serialise event", error);
    return jsonError(500, "internal_error", "Unable to serialise event");
  }

  return NextResponse.json(
    { data: event },
    {
      headers: {
        "cache-control": "private, max-age=60, stale-while-revalidate=300"
      }
    }
  );
}
