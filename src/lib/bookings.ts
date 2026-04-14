import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventBooking, BookingRpcResult } from "@/lib/types";

/**
 * Convert a raw DB row (snake_case, ISO strings) to an EventBooking (camelCase, Dates).
 * Inline conversion — no shared fromDb utility exists in this project.
 */
function rowToEventBooking(row: Record<string, unknown>): EventBooking {
  return {
    id:                     row.id as string,
    eventId:                row.event_id as string,
    firstName:              row.first_name as string,
    lastName:               (row.last_name as string | null) ?? null,
    mobile:                 row.mobile as string,
    email:                  (row.email as string | null) ?? null,
    ticketCount:            row.ticket_count as number,
    status:                 row.status as EventBooking["status"],
    createdAt:              new Date(row.created_at as string),
    smsConfirmationSentAt:  row.sms_confirmation_sent_at
                              ? new Date(row.sms_confirmation_sent_at as string)
                              : null,
    smsReminderSentAt:      row.sms_reminder_sent_at
                              ? new Date(row.sms_reminder_sent_at as string)
                              : null,
    smsPostEventSentAt:     row.sms_post_event_sent_at
                              ? new Date(row.sms_post_event_sent_at as string)
                              : null,
  };
}

/**
 * Atomically check capacity and insert a booking via the create_booking RPC.
 * Uses the service-role client so the RPC can run with security definer privileges.
 */
export async function createBookingAtomic(params: {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  ticketCount: number;
}): Promise<BookingRpcResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_booking", {
    p_event_id:     params.eventId,
    p_first_name:   params.firstName,
    p_last_name:    params.lastName,
    p_mobile:       params.mobile,
    p_email:        params.email,
    p_ticket_count: params.ticketCount,
  });

  if (error) throw new Error(`create_booking RPC failed: ${error.message}`);

  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: result.reason as "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
  }
  return { ok: true, bookingId: result.booking_id! };
}

/**
 * Fetch all bookings for an event.
 * Scoping (venue manager vs planner) enforced by the caller.
 */
export async function getBookingsForEvent(eventId: string): Promise<EventBooking[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch bookings: ${error.message}`);
  return (data ?? []).map((row) => rowToEventBooking(row as Record<string, unknown>));
}

/**
 * Cancel a booking by setting status = 'cancelled'.
 * Uses service-role client — permission check must be done by the caller.
 */
export async function cancelBooking(bookingId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("event_bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (error) throw new Error(`Failed to cancel booking: ${error.message}`);
}

/**
 * Generate a URL-safe slug from an event title and date, guaranteed unique
 * across the events table. Appends a short numeric suffix if there is a
 * collision. Caller is responsible for persisting the returned slug.
 */
export async function generateUniqueEventSlug(title: string, startAt: Date): Promise<string> {
  const db = createSupabaseAdminClient();

  // Build base slug: lowercase, alphanumeric + hyphens, max 60 chars
  const dateStr = startAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const base = `${title}-${dateStr}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  // Check if base is already unique
  const { count: baseCount } = await db
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("seo_slug", base);

  if (!baseCount) return base;

  // Append incrementing suffix until unique
  for (let suffix = 2; suffix <= 99; suffix++) {
    const candidate = `${base}-${suffix}`;
    const { count } = await db
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("seo_slug", candidate);
    if (!count) return candidate;
  }

  // Fallback: append timestamp millis
  return `${base}-${Date.now()}`;
}

/**
 * Get total confirmed ticket count for an event.
 */
export async function getConfirmedTicketCount(eventId: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("ticket_count")
    .eq("event_id", eventId)
    .eq("status", "confirmed");

  if (error) throw new Error(`Failed to count tickets: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.ticket_count as number), 0);
}
