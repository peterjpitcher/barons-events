import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, requireWebsiteApiKey } from "@/lib/public-api/auth";
import { PUBLIC_EVENT_STATUSES, decodeCursor, encodeCursor, toPublicEvent, type RawEventRow } from "@/lib/public-api/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Use an ISO date string" });

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  endsAfter: isoDate.optional(),
  updatedSince: isoDate.optional(),
  venueId: z.string().uuid().optional(),
  eventType: z.string().min(1).max(200).optional()
});

export async function GET(request: Request) {
  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Invalid query parameters", parsed.error.flatten());
  }

  const { limit, cursor, from, to, endsAfter, updatedSince, venueId, eventType } = parsed.data;

  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    return jsonError(400, "invalid_cursor", "Cursor is invalid");
  }

  let supabase;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    console.error("Public API: Supabase service role client is not configured", error);
    return jsonError(503, "not_configured", "Supabase service role is not configured");
  }

  let query = supabase
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
    .in("status", [...PUBLIC_EVENT_STATUSES])
    .order("start_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (from) {
    query = query.gte("start_at", from);
  }
  if (to) {
    query = query.lte("start_at", to);
  }
  if (endsAfter) {
    query = query.gte("end_at", endsAfter);
  }
  if (updatedSince) {
    query = query.gt("updated_at", updatedSince);
  }
  if (venueId) {
    query = query.eq("venue_id", venueId);
  }
  if (eventType) {
    query = query.eq("event_type", eventType);
  }
  if (decodedCursor) {
    query = query.or(
      `start_at.gt.${decodedCursor.startAt},and(start_at.eq.${decodedCursor.startAt},id.gt.${decodedCursor.id})`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Public API: failed to list events", error);
    return jsonError(500, "internal_error", "Unable to load events");
  }

  const rows = (data ?? []) as unknown as RawEventRow[];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  let events;
  try {
    events = slice.map(toPublicEvent);
  } catch (error) {
    console.error("Public API: failed to serialise events", error);
    return jsonError(500, "internal_error", "Unable to serialise events");
  }

  const nextCursor = hasMore ? encodeCursor({ startAt: slice[slice.length - 1].start_at, id: slice[slice.length - 1].id }) : null;

  return NextResponse.json(
    {
      data: events,
      meta: {
        nextCursor
      }
    },
    {
      headers: {
        "cache-control": "private, max-age=30, stale-while-revalidate=300"
      }
    }
  );
}
