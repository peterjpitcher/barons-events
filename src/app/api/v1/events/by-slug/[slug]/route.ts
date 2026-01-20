import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, requireWebsiteApiKey } from "@/lib/public-api/auth";
import { PUBLIC_EVENT_STATUSES, toPublicEvent, type RawEventRow } from "@/lib/public-api/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  slug: z.string().min(1)
});

function extractEventIdFromSlug(slug: string): string | null {
  const match = slug.match(/--([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  return match?.[1] ?? null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonError(400, "invalid_request", "Invalid slug");
  }

  const { slug } = parsedParams.data;
  const eventId = extractEventIdFromSlug(slug);
  if (!eventId) {
    return jsonError(400, "invalid_slug", "Slug must end with `--<eventId>`");
  }

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
    console.error("Public API: failed to fetch event by slug", error);
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
    {
      data: event,
      meta: {
        requestedSlug: slug,
        canonicalSlug: event.slug,
        isCanonical: slug === event.slug
      }
    },
    {
      headers: {
        "cache-control": "private, max-age=60, stale-while-revalidate=300"
      }
    }
  );
}

